import { APIGatewayEvent } from "aws-lambda";
import { ddbDocClient } from "../common/dynamodb";
import { GetCommand, PutCommand } from "@aws-sdk/lib-dynamodb";
import { nextEnvs } from "../common/nextEnvs";
import { GetSecretValueCommand, SecretsManagerClient } from "@aws-sdk/client-secrets-manager";

const sm = new SecretsManagerClient({});

export const handler = async (event: APIGatewayEvent) => {
  const body = JSON.parse(event.body || "{}");
  if (!Object.keys(body).includes("deployment_status")) {
    return {
      statusCode: 200,
    };
  }
  if (!["Deploy", "deploy-to-env"].includes(body?.workflow?.name)) {
    return {
      statusCode: 200,
    };
  }
  const {
    state: status,
    environment: env,
    created_at: createdAt,
    updated_at: updatedAt,
    target_url: url,
  } = body.deployment_status;
  const { id: deploymentId, ref: branch, sha } = body.deployment;
  const repo = body.repository.name;
  const author = body.deployment_status.creator.login;
  const owner = body.repository.owner.login;

  const secret = await sm.send(
    new GetSecretValueCommand({
      SecretId: process.env.SECRET_ARN,
    })
  );
  const slackToken = JSON.parse(secret.SecretString || "").SLACK_TOKEN;

  const pk = `REPO#${repo}#ENV#${env}`.toUpperCase();
  const sk = "LATEST";

  // get deployment status from dynamodb
  const ddbRes = await ddbDocClient.send(
    new GetCommand({
      TableName: process.env.TABLE_NAME,
      Key: {
        pk,
        sk,
      },
    })
  );
  let existingItem = ddbRes.Item;
  if (existingItem && existingItem?.deploymentId !== deploymentId) {
    // update last slack message to remove approve/reject buttons
    const oldBlocks = JSON.parse(existingItem.blocks);
    const approveBlock = oldBlocks.findIndex(
      (block: any) =>
        Object.keys(block).includes("accessory") &&
        block.accessory.value === "approved"
    );
    // remove items from oldBlocks after approveBlock
    oldBlocks.splice(approveBlock, oldBlocks.length - approveBlock);
    oldBlocks.push({
      type: "context",
      elements: [
        {
          type: "mrkdwn",
          text: `Automatic rejection by subsequent deployment`,
        },
      ],
    });

    const slackRes = await fetch("https://slack.com/api/chat.update", {
      method: "POST",
      body: JSON.stringify({
        channel: "C04KW81UAAV",
        ts: existingItem.slackTs,
        blocks: oldBlocks,
      }),
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${slackToken}`,
      },
    });
    await slackRes.json();
    // save old version to history
    await ddbDocClient.send(
      new PutCommand({
        TableName: process.env.TABLE_NAME,
        Item: {
          ...existingItem,
          sk: `DEPLOYMENT#${existingItem.deploymentId}`.toUpperCase(),
          blocks: JSON.stringify(oldBlocks),
        },
      })
    );
    existingItem = {};
  }
  if (existingItem?.status === status) {
    return {
      statusCode: 200,
    };
  }

  const nextEnv = nextEnvs[env];

  const approverRes = await ddbDocClient.send(
    new GetCommand({
      TableName: process.env.TABLE_NAME,
      Key: {
        pk: `APPROVERS`.toUpperCase(),
        sk: `META`.toUpperCase(),
      },
    })
  );
  if (!approverRes.Item) {
    return {
      statusCode: 404,
    };
  }
  const { approvers } = approverRes.Item;

  const actions =
    status === "success" && nextEnv
      ? [
          {
            type: "divider",
          },
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: `:ship: *Deploy to ${nextEnv}*`,
            },
            accessory: {
              type: "button",
              text: {
                type: "plain_text",
                emoji: true,
                text: `Deploy`,
              },
              style: "primary",
              value: "approved",
            },
          },
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: ":octagonal_sign: *Do not deploy to higher envs*",
            },
            accessory: {
              type: "button",
              text: {
                type: "plain_text",
                emoji: true,
                text: "Reject",
              },
              style: "danger",
              value: "rejected",
            },
          },
          {
            type: "divider",
          },
          nextEnv === "prod"
            ? {
                type: "context",
                elements: [
                  {
                    type: "mrkdwn",
                    text: `Current approvers:`,
                  },
                  ...Object.values(approvers).map((approver: any) => ({
                    type: "image",
                    image_url: approver.image,
                    alt_text: approver.name,
                  })),
                ],
              }
            : {
                type: "context",
                elements: [
                  {
                    type: "mrkdwn",
                    text: `No approver is required for deployment to ${nextEnv}`,
                  },
                ],
              },
        ]
      : [];

  const message = {
    blocks: [
      {
        type: "header",
        text: {
          type: "plain_text",
          text: `${repo} deployment to ${env} by ${author}: ${status}`,
          emoji: true,
        },
      },
      {
        type: "section",
        fields: [
          {
            type: "mrkdwn",
            text: `*When:*\n${existingItem?.createdAt || createdAt}`,
          },
          {
            type: "mrkdwn",
            text: `*Updated:*\n${updatedAt || createdAt}`,
          },
        ],
      },
      {
        type: "section",
        fields: [
          {
            type: "mrkdwn",
            text: `*Repo:*\n${repo}`,
          },
          {
            type: "mrkdwn",
            text: `*Branch:*\n${branch}`,
          },
          {
            type: "mrkdwn",
            text: `*Commit:*\n<${url}|${sha}>`,
          },
          {
            type: "mrkdwn",
            text: `*Deployment:*\n${deploymentId}`,
          },
        ],
      },
      ...actions,
    ],
  };
  console.log(JSON.stringify(message, null, 2));

  // send deployment status to slack
  const slackRes = await fetch(
    existingItem?.slackTs
      ? "https://slack.com/api/chat.update"
      : "https://slack.com/api/chat.postMessage",
    {
      method: "POST",
      body: JSON.stringify({
        channel: "C04KW81UAAV",
        ...(existingItem?.slackTs ? { ts: existingItem.slackTs } : {}),
        ...message,
      }),
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${slackToken}`,
      },
    }
  );
  const slack = await slackRes.json();
  console.log(JSON.stringify({ slack }, null, 2));
  const slackTs = slack.ts;
  const slackChannel = slack.channel;

  const item = {
    pk,
    sk,
    author,
    slackTs,
    slackChannel,
    status,
    env,
    repo,
    url,
    sha,
    deploymentId,
    createdAt,
    updatedAt,
    branch,
    owner,
    blocks: JSON.stringify(message.blocks),
  };
  await ddbDocClient.send(
    new PutCommand({ TableName: process.env.TABLE_NAME, Item: item })
  );

  return {
    statusCode: 200,
  };
};
