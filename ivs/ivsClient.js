import { IVSClient } from "@aws-sdk/client-ivs";

let cachedClient = null;

export default function getIvsClient() {
  if (cachedClient) return cachedClient;

  cachedClient = new IVSClient({
    region: process.env.AWS_REGION || "us-west-2",
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    },
  });

  return cachedClient;
}
