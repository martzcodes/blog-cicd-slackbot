import { APIGatewayEvent } from "aws-lambda";
import { ddbDocClient } from "../common/dynamodb";
import { GetCommand, PutCommand } from "@aws-sdk/lib-dynamodb";

export const convertToJSON = (str: string) => {
  const result: Record<string, any> = {};

  // Split by '&' and iterate over each key-value pair
  str.split("&").forEach((pair: string) => {
    const [key, value] = pair.split("=");

    // Use decodeURIComponent to handle URL-encoded characters
    result[decodeURIComponent(key)] = decodeURIComponent(value);
  });

  return result;
};

export const handler = async (event: APIGatewayEvent) => {
  const body = convertToJSON(event.body || "");
  console.log(JSON.stringify({ body }, null, 2));
  const userId = body.text.split("<@")[1].split("|")[0];
  console.log(JSON.stringify({ userId }, null, 2));

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
  if (existingItem.approvers[body.user_id]) {
    delete existingItem.approvers[userId];
    await ddbDocClient.send(
      new PutCommand({
        TableName: process.env.TABLE_NAME,
        Item: existingItem,
      })
    );
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
