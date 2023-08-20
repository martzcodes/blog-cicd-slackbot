import { APIGatewayEvent } from "aws-lambda";
import { ddbDocClient } from "../common/dynamodb";
import { GetCommand, PutCommand } from "@aws-sdk/lib-dynamodb";
import {
  GetSecretValueCommand,
  SecretsManagerClient,
} from "@aws-sdk/client-secrets-manager";
import { slackToJson } from "../common/slackToJson";

const sm = new SecretsManagerClient({});

export const handler = async (event: APIGatewayEvent) => {
  const body = slackToJson(event.body || "");
  const userId = body.text.split("<@")[1].split("|")[0];

  const pk = `APPROVERS`.toUpperCase();
  const sk = `META`.toUpperCase();

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
  const existingItem = ddbRes.Item || {
    pk,
    sk,
    approvers: {},
  };
  if (
    existingItem.approvers[body.user_id] ||
    Object.keys(existingItem.approvers).length === 0
  ) {
    if (!existingItem.approvers[userId]) {
      const secret = await sm.send(
        new GetSecretValueCommand({
          SecretId: process.env.SECRET_ARN,
        })
      );
      const slackToken = JSON.parse(secret.SecretString || "").SLACK_TOKEN;
      const slackUserRes = await fetch(
        `https://slack.com/api/users.profile.get?user=${userId}`,
        {
          method: "GET",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${slackToken}`,
          },
        }
      );
      const slackUser = await slackUserRes.json();
      if (slackUser.ok) {
        const { profile } = slackUser;
        const user = {
          id: userId,
          name: profile.real_name,
          image: profile.image_24,
          email: profile.email,
        };
        existingItem.approvers[userId] = user;
        await ddbDocClient.send(
          new PutCommand({
            TableName: process.env.TABLE_NAME,
            Item: existingItem,
          })
        );
      }
    }
  }

  return {
    statusCode: 200,
    body: JSON.stringify({
      blocks: [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `\`\`\`\n${JSON.stringify(existingItem.approvers)}\`\`\``,
          },
        },
      ],
    }),
  };
};
