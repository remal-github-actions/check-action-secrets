import * as core from '@actions/core'
import { context } from '@actions/github'
import { newOctokitInstance } from './internal/octokit.js'
import { DirectoryContent, FileContent, OrgSecret, Repo } from './internal/types.js'

/* * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * */

const githubToken = core.getInput('githubToken', { required: true })
const ref = core.getInput('ref', { required: false })
const optionalSecrets = core.getInput('optionalSecrets', { required: false })
    .split(/[,;\n\r]/)
    .map(it => it.trim())
    .filter(it => it.length)
const forbiddenSecrets = core.getInput('forbiddenSecrets', { required: false })
    .split(/[,;\n\r]/)
    .map(it => it.trim())
    .filter(it => it.length)
const predefinedSecrets = core.getInput('predefinedSecrets', { required: false })
    .split(/[,;\n\r]/)
    .map(it => it.trim())
    .filter(it => it.length)

const octokit = newOctokitInstance(githubToken)

async function run(): Promise<void> {
    try {
        const repo: Repo = await octokit.repos.get({
            owner: context.repo.owner,
            repo: context.repo.repo,
        }).then(it => it.data)

        const isInOrg = repo.owner?.type?.toLowerCase() === 'organization'


        const allSecrets: string[] = [
            ...predefinedSecrets,
        ]

        if (isInOrg) {
            await core.group('Getting organisation secrets', async () => {
                const allOrgSecrets: OrgSecret[] = await octokit.paginate(octokit.actions.listOrgSecrets, {
                    org: context.repo.owner,
                })
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
            })
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

        let haveUnknownSecrets = false
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
                    const secretMatches = substitutionMatch[1].matchAll(/\b(!+)?secrets\.([\w-]+)(\s*(?:&&|\|\|))?/g)
                    for (const secretMatch of secretMatches) {
                        const secretName = secretMatch[2]
                        const pos = (substitutionMatch.index || 0) + (secretMatch.index || 0)
                        const lines = content.substring(0, pos).split(/\r\n|\n\r|\n|\r/)
                        const line = lines.length
                        const column = lines[lines.length - 1].length

                        if (!allSecrets.includes(secretName)) {
                            const isOptional = optionalSecrets.includes(secretName)
                                || !!secretMatch[1]
                                || !!secretMatch[3]
                            if (isOptional) {
                                core.info(`Not configured optional secret: ${secretName} (pos: ${line}:${column})`/*, {
                                    file: workflowFilePath,
                                    startLine: line,
                                    startColumn: column,
                                }*/)

                            } else {
                                haveUnknownSecrets = true
                                core.error(`Not configured secret: ${secretName}`, {
                                    file: workflowFilePath,
                                    startLine: line,
                                    startColumn: column,
                                })
                            }

                        } else {
                            core.info(`Configured secret: ${secretName} (pos: ${line}:${column})`/*, {
                                file: workflowFilePath,
                                startLine: line,
                                startColumn: column,
                            }*/)
                        }
                    }
                }
            })
        }

        if (haveUnknownSecrets) {
            throw new Error('Workflow files with unknown secrets found')
        }

        let haveForbiddenSecrets = false
        for (const forbiddenSecret of forbiddenSecrets) {
            if (allSecrets.includes(forbiddenSecret)) {
                core.error(`Forbidden secret: ${forbiddenSecret}`)
                haveForbiddenSecrets = true
            }
        }
        if (haveForbiddenSecrets) {
            throw new Error('Repository (or organisation) has forbidden secrets defined')
        }

    } catch (error) {
        core.setFailed(error instanceof Error ? error : `${error}`)
        throw error
    }
}

//noinspection JSIgnoredPromiseFromCall
run()
