#!/usr/bin/env node

const axios = require('axios');
const process = require('process');

// Get environment variables
const PAT = process.env.PAT;
const REPO_OWNER = process.env.REPO_OWNER;
const TARGET_CLEANUP_REPOS = process.env.TARGET_CLEANUP_REPOS || '';
const TARGET_IGNORE_REPOS = process.env.TARGET_IGNORE_REPOS || '';
const DAYS_THRESHOLD = process.env.DAYS_THRESHOLD || '7';
const NOTIFICATION_WEBHOOK_URL = process.env.NOTIFICATION_WEBHOOK_URL || '';

const sevenDaysAgo = new Date();
sevenDaysAgo.setDate(sevenDaysAgo.getDate() - parseInt(DAYS_THRESHOLD));
const sevenDaysAgoISO = sevenDaysAgo.toISOString();

let errorOccurred = false;

(async () => {
  try {
    console.log('Starting cleanup of old workflow runs...');

    const perPage = 100;
    let reposArray = [];
    let ignoreReposArray = [];

    // Parse ignore repos
    if (TARGET_IGNORE_REPOS) {
      console.log('Using repositories to ignore from TARGET_IGNORE_REPOS variable.');
      ignoreReposArray = TARGET_IGNORE_REPOS.split(',').map(repo => repo.trim());
    }

    // Parse target cleanup repos
    if (TARGET_CLEANUP_REPOS) {
      console.log('Using specified repositories from TARGET_CLEANUP_REPOS variable.');
      reposArray = TARGET_CLEANUP_REPOS.split(',').map(repo => repo.trim());
    } else {
      console.log('No TARGET_CLEANUP_REPOS specified. Processing all repositories except those in TARGET_IGNORE_REPOS.');

      // Fetch all repositories owned by REPO_OWNER
      let page = 1;
      while (true) {
        const response = await axios.get(`https://api.github.com/users/${REPO_OWNER}/repos`, {
          params: {
            per_page: perPage,
            page: page,
          },
          headers: {
            Authorization: `token ${PAT}`,
          },
        });

        const repos = response.data.map(repo => repo.full_name);

        if (repos.length === 0) {
          console.log('No more repositories found.');
          break;
        }

        for (const repo of repos) {
          if (ignoreReposArray.includes(repo)) {
            console.log(`Skipping repository (ignored): ${repo}`);
          } else {
            reposArray.push(repo);
          }
        }

        page += 1;
      }
    }

    // Validate repository names
    for (const repo of reposArray) {
      if (!/^[^/]+\/[^/]+$/.test(repo)) {
        console.error(`Invalid repository format: ${repo}. Expected format 'owner/repo'.`);
        process.exit(1);
      }
    }

    if (reposArray.length === 0) {
      console.log('No repositories to process after applying filters.');
      process.exit(0);
    }

    // Loop through repositories
    for (const repo of reposArray) {
      console.log(`Processing repository: ${repo}`);

      let runPage = 1;
      while (true) {
        try {
          const runsResponse = await axios.get(`https://api.github.com/repos/${repo}/actions/runs`, {
            params: {
              per_page: perPage,
              page: runPage,
            },
            headers: {
              Authorization: `token ${PAT}`,
            },
          });

          const runs = runsResponse.data.workflow_runs.filter(run => {
            return new Date(run.created_at) < sevenDaysAgo;
          });

          if (runs.length === 0) {
            console.log(`No more runs to process in repository: ${repo}.`);
            break;
          }

          for (const run of runs) {
            const runId = run.id;
            console.log(`Deleting workflow run ${runId} in repository ${repo}`);

            try {
              await axios.delete(`https://api.github.com/repos/${repo}/actions/runs/${runId}`, {
                headers: {
                  Authorization: `token ${PAT}`,
                },
              });
              console.log(`Successfully deleted run ${runId}.`);
            } catch (deleteError) {
              errorOccurred = true;
              console.error(`Failed to delete run ${runId}. Response: ${deleteError.response.data.message}`);
            }
          }

          runPage += 1;
        } catch (runsError) {
          errorOccurred = true;
          console.error(`Failed to fetch runs for repository ${repo}. Response: ${runsError.response.data.message}`);
          break;
        }
      }
    }

    console.log('Cleanup completed.');
  } catch (err) {
    errorOccurred = true;
    console.error(`An error occurred: ${err.message}`);
  } finally {
    // Send notification if webhook URL is provided
    const message = errorOccurred
      ? 'Workflow cleanup encountered errors.'
      : 'Workflow cleanup completed successfully.';

    if (NOTIFICATION_WEBHOOK_URL) {
      try {
        await axios.post(NOTIFICATION_WEBHOOK_URL, { text: message });
        console.log('Notification sent.');
      } catch (notifyError) {
        console.error(`Failed to send notification: ${notifyError.message}`);
      }
    }

    if (errorOccurred) {
      process.exit(1);
    }
  }
})();
