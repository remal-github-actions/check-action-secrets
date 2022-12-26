import * as core from '@actions/core'
import { context } from '@actions/github'
import { newOctokitInstance } from './internal/octokit'
import { DirectoryContent, FileContent, OrgSecret, Repo, RepoSecret } from './internal/types'

/* * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * */

const githubToken = core.getInput('githubToken', { required: true })
const ref = core.getInput('ref', { required: false })

const octokit = newOctokitInstance(githubToken)

async function run(): Promise<void> {
    try {
        const repo: Repo = await octokit.repos.get({
            owner: context.repo.owner,
            repo: context.repo.repo,
        }).then(it => it.data)

        const isInOrg = repo.owner?.type?.toLowerCase() === 'organization'


        const allSecrets: string[] = []

        if (isInOrg) {
            await core.group('Getting organisation secrets', async () => {
                const allOrgSecrets: OrgSecret[] = await octokit.paginate(octokit.actions.listOrgSecrets, {
                    org: context.repo.owner,
                }).then(it => it.secrets != null ? it.secrets : it as OrgSecret[])
                const orgSecrets: OrgSecret[] = []
                for (const orgSecret of allOrgSecrets) {
                    if (orgSecret.visibility == null || orgSecret.visibility.toLowerCase() === 'all') {
                        orgSecrets.push(orgSecret)
                    } else if (orgSecret.visibility.toLowerCase() === 'private') {
                        if (repo.visibility === 'private') {
                            orgSecrets.push(orgSecret)
                        }
                    } else if (orgSecret.visibility.toLowerCase() === 'selected') {
                        const selectedRepoNames = await octokit.actions.listSelectedReposForOrgSecret({
                            org: context.repo.owner,
                            secret_name: orgSecret.name,
                        }).then(it => it.data.repositories.map(that => that.full_name))
                        if (selectedRepoNames.includes(repo.full_name)) {
                            orgSecrets.push(orgSecret)
                        }
                    }
                }
                const orgSecretNames = orgSecrets.map(it => it.name)
                allSecrets.push(...orgSecretNames)
                if (orgSecretNames.length) {
                    core.info(`Organisation secrets for this repository:\n  ${orgSecretNames.join('\n  ')}`)
                } else {
                    core.info(`No organisation secrets set for this repository`)
                }
            })
        }

        await core.group('Getting repository secrets', async () => {
            const repoSecrets = await octokit.paginate(octokit.actions.listRepoSecrets, {
                owner: context.repo.owner,
                repo: context.repo.repo,
            }).then(it => it.secrets != null ? it.secrets : it as RepoSecret[])
            const repoSecretNames = repoSecrets.map(it => it.name)
            allSecrets.push(...repoSecretNames)
            if (repoSecretNames.length) {
                core.info(`Repository secrets:\n  ${repoSecretNames.join('\n  ')}`)
            } else {
                core.info(`No repository secrets set`)
            }
        })


        const workflowsDir = '.github/workflows'
        const workflowFiles: DirectoryContent = await octokit.repos.getContent({
            owner: context.repo.owner,
            repo: context.repo.repo,
            path: workflowsDir,
            ref,
        }).then(it => it.data as any)
        if (!Array.isArray(workflowFiles)) {
            return
        }

        let haveErrors = false
        for (const workflowFile of workflowFiles) {
            if (workflowFile.type !== 'file') continue
            if (!workflowFile.name.endsWith('.yml')) continue
            await core.group(`Processing ${workflowFile.url}`, async () => {
                const workflowFilePath = `${workflowsDir}/${workflowFile.name}`
                const contentInfo: FileContent = await octokit.repos.getContent({
                    owner: context.repo.owner,
                    repo: context.repo.repo,
                    path: workflowFilePath,
                    ref,
                }).then(it => it.data as any)
                const content = contentInfo.encoding?.toLowerCase() === 'base64'
                    ? Buffer.from(contentInfo.content, 'base64').toString('utf8')
                    : contentInfo.content

                const substitutionMatches = content.matchAll(/\$\{\{([\s\S]+?)}}/g)
                for (const substitutionMatch of substitutionMatches) {
                    const secretMatches = substitutionMatch[1].matchAll(/\bsecrets\.([\w-]+)/g)
                    for (const secretMatch of secretMatches) {
                        const secretName = secretMatch[1]
                        if (!allSecrets.includes(secretName)) {
                            haveErrors = true
                            const pos = (substitutionMatch.index || 0) + (secretMatch.index || 0)
                            const lines = content.substring(0, pos).split(/(\r\n|\n\r|\n|\r)/)
                            const line = lines.length
                            const column = lines[lines.length - 1].length
                            core.error(`Unknown secret: ${secretName}`, {
                                file: workflowFilePath,
                                startLine: line,
                                startColumn: column,
                            })
                        }
                    }
                }
            })
        }

        if (haveErrors) {
            throw new Error('Workflow files with unknown secrets found')
        }

        throw new Error('test')

    } catch (error) {
        core.setFailed(error instanceof Error ? error : (error as object).toString())
        throw error
    }
}

//noinspection JSIgnoredPromiseFromCall
run()
