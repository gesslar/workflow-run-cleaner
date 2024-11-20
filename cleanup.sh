#!/bin/bash

set -e

echo "Starting cleanup of old workflow runs..."

# Inputs
PAT="${PAT}"
REPO_OWNER="${REPO_OWNER}"
TARGET_CLEANUP_REPOS="${TARGET_CLEANUP_REPOS}"
TARGET_IGNORE_REPOS="${TARGET_IGNORE_REPOS}"
DAYS_THRESHOLD="${DAYS_THRESHOLD:-7}"
NOTIFICATION_WEBHOOK_URL="${NOTIFICATION_WEBHOOK_URL}"
ERROR_OCCURRED="false"

echo "Starting cleanup of old workflow runs..."

# Install jq for JSON parsing
sudo apt-get update && sudo apt-get install -y jq

# Set variables
per_page=100
age_threshold=${TARGET_CLEANUP_DAYS:-7}  # Default to 7 days if not set
seven_days_ago=$(date -d "$age_threshold days ago" +%s)

# Initialize arrays
repos_array=()
ignore_repos_array=()

# Convert TARGET_IGNORE_REPOS into an array if set
if [ -n "$TARGET_IGNORE_REPOS" ]; then
  echo "Using repositories to ignore from TARGET_IGNORE_REPOS secret."
  IFS=',' read -r -a ignore_repos_array_raw <<< "$TARGET_IGNORE_REPOS"
  for repo in "${ignore_repos_array_raw[@]}"; do
    ignore_repos_array+=("$(echo "$repo" | xargs)")  # Trim whitespace
  done
fi

# Check if TARGET_CLEANUP_REPOS is set
if [ -n "$TARGET_CLEANUP_REPOS" ]; then
  echo "Using specified repositories from TARGET_CLEANUP_REPOS secret."
  # Convert comma-separated list into an array
  IFS=',' read -r -a repos_array_raw <<< "$TARGET_CLEANUP_REPOS"
  for repo in "${repos_array_raw[@]}"; do
    repos_array+=("$(echo "$repo" | xargs)")  # Trim whitespace
  done
else
  echo "No TARGET_CLEANUP_REPOS specified. Processing all repositories except those in TARGET_IGNORE_REPOS."
  # Fetch all repositories owned by REPO_OWNER
  page=1
  while true; do
    response=$(curl -s -H "Authorization: token $PAT" \
      "https://api.github.com/users/$REPO_OWNER/repos?per_page=$per_page&page=$page")

    repos=$(echo "$response" | jq -r '.[].full_name')

    if [ -z "$repos" ]; then
      echo "No more repositories found."
      break
    fi

    for repo in $repos; do
      # Check if the repo is in the ignore list
      if [[ " ${ignore_repos_array[@]} " =~ " $repo " ]]; then
        echo "Skipping repository (ignored): $repo"
      else
        repos_array+=("$repo")
      fi
    done

    page=$((page + 1))
  done
fi

# Validate repository names
for repo in "${repos_array[@]}"; do
  if [[ ! $repo =~ ^[^/]+/[^/]+$ ]]; then
    echo "Invalid repository format: $repo. Expected format 'owner/repo'."
    exit 1
  fi
done

# Loop through repositories in repos_array
for repo in "${repos_array[@]}"; do
  echo "Processing repository: $repo"

  # Get workflow runs
  run_page=1
  while true; do
    runs_response=$(curl -s -H "Authorization: token $PAT" \
      "https://api.github.com/repos/$repo/actions/runs?per_page=$per_page&page=$run_page")

    runs=$(echo "$runs_response" | jq -r \
      --argjson date "$seven_days_ago" \
      '.workflow_runs[] | select((.created_at | strptime("%Y-%m-%dT%H:%M:%SZ") | mktime) < $date) | .id')

    if [ -z "$runs" ]; then
      echo "No more runs to process in repository: $repo."
      break
    fi

    for run_id in $runs; do
      echo "Deleting workflow run $run_id in repository $repo"
      delete_response=$(curl -s -X DELETE -H "Authorization: token $PAT" \
        "https://api.github.com/repos/$repo/actions/runs/$run_id")

      if [ -z "$delete_response" ]; then
        echo "Successfully deleted run $run_id."
      else
        echo "Failed to delete run $run_id. Response: $delete_response"
      fi
    done

    run_page=$((run_page + 1))
  done
done


echo "Cleanup completed."
