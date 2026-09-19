import { MongoClient, type MongoClientOptions } from "mongodb";

if (!process.env.MONGODB_URI) {
  throw new Error("MONGODB_URI environment variable is not set");
}

const uri = process.env.MONGODB_URI;
const options: MongoClientOptions = {
  appName: "oria",
  maxIdleTimeMS: 60_000,
  maxPoolSize: 10,
  minPoolSize: 0,
  retryReads: true,
  retryWrites: true,
  serverSelectionTimeoutMS: 10_000,
};
const MAX_CONNECT_ATTEMPTS = 2;

declare global {
  var _mongoClientPromise: Promise<MongoClient> | undefined;
}

function getMongoClientPromise() {
  if (global._mongoClientPromise) return global._mongoClientPromise;

  const connection = connectWithRetry();
  global._mongoClientPromise = connection;

  void connection.catch(() => {
    if (global._mongoClientPromise === connection) {
      global._mongoClientPromise = undefined;
    }
  });

  return connection;
}

async function connectWithRetry() {
  for (let attempt = 1; attempt <= MAX_CONNECT_ATTEMPTS; attempt += 1) {
    const client = new MongoClient(uri, options);
    try {
      return await client.connect();
    } catch (error) {
      await client.close().catch((closeError) => {
        console.error("Failed to close an unsuccessful MongoDB client.", closeError);
      });

      if (!isConnectionReset(error) || attempt === MAX_CONNECT_ATTEMPTS) {
        throw error;
      }

      console.warn(`MongoDB connection reset; retrying (${attempt}/${MAX_CONNECT_ATTEMPTS}).`);
      await delay(250 * attempt);
    }
  }

  throw new Error("MongoDB connection attempts exhausted.");
}

function isConnectionReset(error: unknown) {
  if (!error || typeof error !== "object") return false;
  if ("code" in error && error.code === "ECONNRESET") return true;
  if (!("cause" in error) || !error.cause || typeof error.cause !== "object") return false;
  return "code" in error.cause && error.cause.code === "ECONNRESET";
}

function delay(milliseconds: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
}

const clientPromise: PromiseLike<MongoClient> = {
  then(onfulfilled, onrejected) {
    return getMongoClientPromise().then(onfulfilled, onrejected);
  },
};

export default clientPromise;
