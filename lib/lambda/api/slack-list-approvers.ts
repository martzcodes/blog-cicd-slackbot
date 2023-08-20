import { ddbDocClient } from "../common/dynamodb";
import { GetCommand } from "@aws-sdk/lib-dynamodb";

export const handler = async () => {
  const pk = `APPROVERS`.toUpperCase();
  const sk = `META`.toUpperCase();

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
