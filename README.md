# workflow-run-cleaner

Use this action to clean up old workflow runs from your GitHub repositories.

## Usage

```yaml
name: Cleanup Old Workflow Runs

on:
  schedule:
    - cron: '0 0 * * *'  # Daily at midnight UTC
  workflow_dispatch:     # Manual trigger

jobs:
  cleanup:
    runs-on: ubuntu-latest
    steps:
      - name: Run Workflow Cleanup Action
        uses: gesslar/workflow-run-cleaner@main
        with:
          # Personal Access Token (classic) with repo and workflow scopes
          # (https://github.com/settings/tokens)
          token: ''

          # Owner of the repositories. You should set this to the owner of the
          # repositories you want to clean up.
          repo-owner: ${{ github.repository_owner }}

          # Comma-separated list of repositories to include in the cleanup.
          # If you don't set this, the action will clean up all repositories
          # that the token has access to. Which may be desirable, but be aware
          # that this may clean up workflow runs for repositories you don't
          # want to clean up.
          target-cleanup-repos: ${{ vars.TARGET_CLEANUP_REPOS }}

          # Comma-separated list of repositories to exclude from the cleanup.
          # If you don't set this, the action will not exclude any
          # repositories. This is useful if you want to clean up all
          # repositories that the token has access to, except for a few
          # that you don't want to clean up. Works well when
          # target-cleanup-repos is set to all repositories that the token has
          # access to.
          target-ignore-repos: ${{ vars.TARGET_CLEANUP_IGNORE_REPOS }}

          # Number of days to keep workflow runs.
          #
          # Defaults to 7 days if not set.
          days-threshold: ${{ vars.CLEANUP_DAYS_THRESHOLD }}

          # Debug mode.
          # Defaults to false if not set.
          debug: ${{ vars.DEBUG }}
```

## Inputs

| Input | Description | Required | Default |
|-------|-------------|----------|---------|
| `token` | GitHub token with permissions to delete workflow runs. Should have repo and workflow scopes. | Yes | N/A |
| `repo-owner` | Repository owner (can be a username or organization name). | No | `${{ github.repository_owner }}` |
| `target-cleanup-repos` | Comma-separated list of repositories to include in the cleanup. | No | All repos token has access to |
| `target-ignore-repos` | Comma-separated list of repositories to exclude from the cleanup. | No | None |
| `days-threshold` | Number of days to keep workflow runs. Older runs will be deleted. | No | `7` |
| `debug` | Enable debug mode for more verbose logging. | No | `false` |

## License

Unlicensed. Feel free to use this code in any way you like.
