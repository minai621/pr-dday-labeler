import * as core from "@actions/core";
import * as github from "@actions/github";
import axios from "axios";

type DdayLabel = "D-3" | "D-2" | "D-1" | "D-0";

async function run(): Promise<void> {
  try {
    const token = core.getInput("github-token", { required: true });
    const slackWebhookUrl = core.getInput("slack-webhook-url", {
      required: true,
    });
    const octokit = github.getOctokit(token);

    const { context } = github;
    const { owner, repo } = context.repo;

    if (
      context.eventName === "schedule" ||
      context.eventName === "workflow_dispatch"
    ) {
      await updatePRLabels(octokit, owner, repo, slackWebhookUrl);
    } else if (context.eventName === "pull_request") {
      await addDdayLabel(
        octokit,
        owner,
        repo,
        context.payload.pull_request!.number,
        slackWebhookUrl
      );
    }
  } catch (error) {
    if (error instanceof Error) core.setFailed(error.message);
  }
}

async function updatePRLabels(
  octokit: ReturnType<typeof github.getOctokit>,
  owner: string,
  repo: string,
  slackWebhookUrl: string
): Promise<void> {
  const pulls = await octokit.rest.pulls.list({ owner, repo, state: "open" });

  for (const pr of pulls.data) {
    const currentLabel = pr.labels.find((label) =>
      label.name.startsWith("D-")
    ) as { name: DdayLabel } | undefined;
    let newLabel: DdayLabel;

    if (!currentLabel) {
      console.log(`PR #${pr.number}: No D- label found, setting to D-3`);
      newLabel = "D-3";
    } else {
      const day = parseInt(currentLabel.name.slice(2));
      newLabel = day > 0 ? (`D-${day - 1}` as DdayLabel) : "D-0";
      console.log(
        `PR #${pr.number}: Current label is ${currentLabel.name}, setting to ${newLabel}`
      );
    }

    if (newLabel !== currentLabel?.name) {
      console.log(`PR #${pr.number}: Updating label to ${newLabel}`);
      await octokit.rest.issues.setLabels({
        owner,
        repo,
        issue_number: pr.number,
        labels: [
          newLabel,
          ...pr.labels
            .filter((label) => !label.name.startsWith("D-"))
            .map((label) => label.name),
        ],
      });

      await sendSlackNotification(
        slackWebhookUrl,
        {
          number: pr.number,
          title: pr.title,
          html_url: pr.html_url,
          user: { login: pr.user?.login ?? "Unknown" },
        },
        newLabel
      );
    } else {
      console.log(
        `PR #${pr.number}: Label is already set to ${newLabel}, no update needed.`
      );
    }
  }
}

async function addDdayLabel(
  octokit: ReturnType<typeof github.getOctokit>,
  owner: string,
  repo: string,
  prNumber: number,
  slackWebhookUrl: string
): Promise<void> {
  await octokit.rest.issues.addLabels({
    owner,
    repo,
    issue_number: prNumber,
    labels: ["D-3"],
  });

  const { data: pr } = await octokit.rest.pulls.get({
    owner,
    repo,
    pull_number: prNumber,
  });
  await sendSlackNotification(
    slackWebhookUrl,
    {
      number: pr.number,
      title: pr.title,
      html_url: pr.html_url,
      user: { login: pr.user?.login ?? "Unknown" },
    },
    "D-3"
  );
}

async function sendSlackNotification(
  slackWebhookUrl: string,
  pr: {
    number: number;
    title: string;
    html_url: string;
    user: { login: string };
  },
  label: DdayLabel
): Promise<void> {
  const message = {
    text: `PR #${pr.number} "${pr.title}" has been labeled with ${label}`,
    blocks: [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `*PR #${pr.number} has been updated*`,
        },
      },
      {
        type: "section",
        fields: [
          {
            type: "mrkdwn",
            text: `*Title:* ${pr.title}`,
          },
          {
            type: "mrkdwn",
            text: `*Label:* ${label}`,
          },
          {
            type: "mrkdwn",
            text: `*Author:* ${pr.user.login}`,
          },
          {
            type: "mrkdwn",
            text: `*Link:* <${pr.html_url}|View PR>`,
          },
        ],
      },
    ],
  };

  if (label === "D-0") {
    message.blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: ":warning: *This PR is due today!* :warning:",
      },
    });
  }

  await axios.post(slackWebhookUrl, message);
}

run();
