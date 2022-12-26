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


        const allSecretsUnsorted: string[] = []

        if (isInOrg) {
            core.info('Getting organisation secrets')
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
            allSecretsUnsorted.push(...orgSecretNames)
            if (orgSecretNames) {
                core.info(`Organisation secrets for this repository:\n  ${orgSecretNames.join('\n  ')}`)
            } else {
                core.info(`No organisation secrets set for this repository`)
            }
        }

        core.info('Getting repository secrets')
        const repoSecrets = await octokit.paginate(octokit.actions.listRepoSecrets, {
            owner: context.repo.owner,
            repo: context.repo.repo,
        }).then(it => it.secrets != null ? it.secrets : it as RepoSecret[])
        const repoSecretNames = repoSecrets.map(it => it.name)
        allSecretsUnsorted.push(...repoSecretNames)
        if (repoSecretNames) {
            core.info(`Repository secrets:\n  ${repoSecretNames.join('\n  ')}`)
        } else {
            core.info(`No repository secrets set`)
        }


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
        for (const workflowFile of workflowFiles) {
            if (workflowFile.type !== 'file') continue
            if (!workflowFile.name.endsWith('.yml')) continue
            await core.group(`Processing ${workflowFile.url}`, async () => {
                const workflowFileContent: FileContent = await octokit.repos.getContent({
                    owner: context.repo.owner,
                    repo: context.repo.repo,
                    path: `${workflowsDir}/${workflowFile.name}`,
                    ref,
                }).then(it => it.data as any)
                const content = workflowFileContent.encoding?.toLowerCase() === 'base64'
                    ? Buffer.from(workflowFileContent.content, 'base64').toString('utf8')
                    : workflowFileContent.content
                core.info(content)
                //const contentLines = content.split(/(\r\n|\n\r|\n|\r)/)
            })
        }

        throw new Error('test')

    } catch (error) {
        core.setFailed(error instanceof Error ? error : (error as object).toString())
        throw error
    }
}

//noinspection JSIgnoredPromiseFromCall
run()
