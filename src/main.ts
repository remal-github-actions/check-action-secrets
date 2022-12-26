import * as core from '@actions/core'
import { context } from '@actions/github'
import { components } from '@octokit/openapi-types'
import { newOctokitInstance } from './internal/octokit'

/* * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * */

const githubToken = core.getInput('githubToken', { required: true })
const ref = core.getInput('ref', { required: false })

const octokit = newOctokitInstance(githubToken)

async function run(): Promise<void> {
    try {
        const repo = await octokit.repos.get({
            owner: context.repo.owner,
            repo: context.repo.repo,
        }).then(it => it.data)


        const allSecretsUnsorted: string[] = []

        if (repo.owner?.type?.toLowerCase() === 'organization') {
            core.info('Getting organisation secrets')
            const orgSecrets = await octokit.paginate(octokit.actions.listOrgSecrets, {
                org: context.repo.owner,
            }).then(it => it.secrets.map(secret => secret.name))
            allSecretsUnsorted.push(...orgSecrets)
        }

        core.info('Getting repository secrets')
        const repoSecrets = await octokit.paginate(octokit.actions.listRepoSecrets, {
            owner: context.repo.owner,
            repo: context.repo.repo,
        }).then(it => it.secrets.map(secret => secret.name))
        allSecretsUnsorted.push(...repoSecrets)

        const allSecrets = [...new Set(allSecretsUnsorted)].sort()
        core.info(`Accessible secrets:\n  ${allSecrets.join('\n  ')}`)


        const workflowFiles: components['schemas']['content-directory'] = await octokit.repos.getContent({
            owner: context.repo.owner,
            repo: context.repo.repo,
            path: '.github/workflows',
            ref,
        }).then(it => it.data as any)
        for (const workflowFile of workflowFiles) {
            if (workflowFile.name.endsWith('.yml')) {
                core.info(`Processing ${workflowFile.name}`)
            }
        }

    } catch (error) {
        core.setFailed(error instanceof Error ? error : (error as object).toString())
        throw error
    }
}

//noinspection JSIgnoredPromiseFromCall
run()
