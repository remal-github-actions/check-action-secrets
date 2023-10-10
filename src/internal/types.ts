import type { components } from '@octokit/openapi-types'

export type Repo = components['schemas']['full-repository']

export type OrgSecret = components['schemas']['organization-actions-secret']
export type RepoSecret = components['schemas']['actions-secret']

export type DirectoryContent = components['schemas']['content-directory']
export type FileContent = components['schemas']['content-file']
