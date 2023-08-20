import { APIGatewayEvent } from "aws-lambda";
import { ddbDocClient } from "../common/dynamodb";
import { GetCommand, PutCommand } from "@aws-sdk/lib-dynamodb";
import { nextEnvs } from "../common/nextEnvs";
import { oidcs } from "../common/oidcs";
import {
  GetSecretValueCommand,
  SecretsManagerClient,
} from "@aws-sdk/client-secrets-manager";

const sm = new SecretsManagerClient({});

export const handler = async (event: APIGatewayEvent) => {
  const decodedString = decodeURIComponent(event.body!);
  const jsonString = decodedString.replace("payload=", "");
  const jsonObject = JSON.parse(jsonString);
  const message = jsonObject.message;
  const approved = jsonObject.actions[0].value === "approved";
  const repo = jsonObject.message.text.split("Repo:*\n")[1].split("+")[0];
  const env = jsonObject.message.text
    .split("+deployment+to+")[1]
    .split("+by+")[0];
  const authority = jsonObject.user.name;
  const branch = jsonObject.message.text.split("Branch:*\n")[1].split("+")[0];

  const secret = await sm.send(
    new GetSecretValueCommand({
      SecretId: process.env.SECRET_ARN,
    })
  );
  const slackToken = JSON.parse(secret.SecretString || "").SLACK_TOKEN;
  const githubToken = JSON.parse(secret.SecretString || "").GITHUB_TOKEN;

  const slackAuthorityRes = await fetch(
    `https://slack.com/api/users.profile.get?user=${jsonObject.user.id}`,
    {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${slackToken}`,
      },
    }
  );
  const slackAuthority = await slackAuthorityRes.json();
  const userImg = slackAuthority.profile.image_24;
  message.blocks = message.blocks.filter((msg: any) => msg.type !== "actions");
  message.blocks[0].text.text = message.blocks[0].text.text.replace(/\+/g, " ");
  const approveBlock = message.blocks.findIndex(
    (block: any) =>
      Object.keys(block).includes("accessory") &&
      block.accessory.value === "approved"
  );
  let rejectedBlock = message.blocks.findIndex(
    (block: any) =>
      Object.keys(block).includes("accessory") &&
      block.accessory.value === "rejected"
  );
  // if the block below actionBlock is context, add user image to elements
  const contextBlock = {
    type: "context",
    elements: [
      {
        type: "image",
        image_url: userImg,
        alt_text: authority,
      },
      {
        type: "mrkdwn",
        text: `thinks we should *${
          approved ? "approve" : "reject"
        }* this deployment`,
      },
    ],
  };
  if (approved) {
    if (message.blocks[approveBlock + 1].type !== "context") {
      message.blocks.splice(approveBlock + 1, 0, contextBlock);
      rejectedBlock += 1;
    }
    if (
      message.blocks[approveBlock + 1].elements.filter(
        (element: any) => element.image_url === userImg
      ).length === 0
    ) {
      message.blocks[approveBlock + 1].elements.unshift({
        type: "image",
        image_url: userImg,
        alt_text: authority,
      });
    }
    if (
      rejectedBlock + 1 < message.blocks.length &&
      message.blocks[rejectedBlock + 1].type === "context"
    ) {
      // remove user from rejected block
      message.blocks[rejectedBlock + 1].elements = message.blocks[
        rejectedBlock + 1
      ].elements.filter((element: any) => element.image_url !== userImg);
      if (message.blocks[rejectedBlock + 1].elements.length === 1) {
        message.blocks.splice(rejectedBlock + 1, 1);
      }
    }
  } else {
    if (message.blocks[rejectedBlock + 1].type !== "context") {
      message.blocks.splice(rejectedBlock + 1, 0, contextBlock);
    }
    // check to make sure the user image isn't already in the context block
    if (
      message.blocks[rejectedBlock + 1].elements.filter(
        (element: any) => element.image_url === userImg
      ).length === 0
    ) {
      message.blocks[rejectedBlock + 1].elements.unshift({
        type: "image",
        image_url: userImg,
        alt_text: authority,
      });
    }
    if (message.blocks[approveBlock + 1].type === "context") {
      // remove user from approve block
      message.blocks[approveBlock + 1].elements = message.blocks[
        approveBlock + 1
      ].elements.filter((element: any) => element.image_url !== userImg);
      if (message.blocks[approveBlock + 1].elements.length === 1) {
        message.blocks.splice(approveBlock + 1, 1);
      }
    }
  }

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
  const existingItem = ddbRes.Item;
  if (!existingItem) {
    return {
      statusCode: 404,
    };
  }
  if (
    Object.keys(existingItem).includes("approved") &&
    Object.keys(existingItem).includes("rejected")
  ) {
    return {
      statusCode: 400,
    };
  }

  let needsApproval = nextEnvs[env] === "prod";
  let approvedByApprover = false;
  if (needsApproval) {
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
    approvedByApprover = Object.keys(approvers).includes(jsonObject.user.id);
  }

  if (!needsApproval || approvedByApprover) {
    existingItem.approved = approved;
    existingItem.rejected = !approved;
    existingItem.authority = authority;
    if (message.blocks[approveBlock + 1].type !== "context") {
      // remove approveBlock
      message.blocks.splice(approveBlock, 1);
      rejectedBlock -= 1;
    }
    if (message.blocks[rejectedBlock + 1].type !== "context") {
      // remove rejectedBlock
      message.blocks.splice(rejectedBlock, 1);
    }
    // remove accessories from blocks
    message.blocks = message.blocks.map((block: any) => {
      if (block.accessory) {
        delete block.accessory;
      }
      return block;
    });
    message.blocks.push({
      type: "context",
      elements: [
        {
          type: "plain_text",
          emoji: true,
          text: `${approved ? "Approved" : "Rejected"} by ${authority}`,
        },
      ],
    });
    // remove current approvers from message
    message.blocks = message.blocks.filter(
      (block: any) =>
        !(
          block.type === "context" &&
          `${block.elements[0].text}`.toLowerCase().includes("approver")
        )
    );

    await ddbDocClient.send(
      new PutCommand({ TableName: process.env.TABLE_NAME, Item: existingItem })
    );

    if (approved) {
      const githubListWorkflowsRes = await fetch(
        `https://api.github.com/repos/${existingItem.owner}/${repo}/actions/workflows`,
        {
          method: "GET",
          headers: {
            Accept: "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
            Authorization: `Bearer ${githubToken}`,
          },
        }
      );
      const { workflows } = await githubListWorkflowsRes.json();
      const workflow = workflows.find(
        (workflow: any) => workflow.name === "deploy-to-env"
      );
      if (!workflow) {
        return {
          statusCode: 404,
        };
      }
      await fetch(
        `https://api.github.com/repos/${existingItem.owner}/${repo}/actions/workflows/${workflow.id}/dispatches`,
        {
          method: "POST",
          body: JSON.stringify({
            ref: branch,
            inputs: {
              deploy_env: nextEnvs[env],
              oidc_role: oidcs[nextEnvs[env]],
            },
          }),
          headers: {
            Accept: "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
            Authorization: `Bearer ${githubToken}`,
          },
        }
      );
    }
  }

  const slackRes = await fetch("https://slack.com/api/chat.update", {
    method: "POST",
    body: JSON.stringify({
      channel: "C04KW81UAAV",
      ts: jsonObject.message.ts,
      blocks: message.blocks,
    }).replace(/\+/g, " "),
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${slackToken}`,
    },
  });
  const slack = await slackRes.json();
  if (!slack.ok) {
    return {
      statusCode: 500,
      body: JSON.stringify({ slack }),
    };
  }

  return {
    statusCode: 200,
  };
};
