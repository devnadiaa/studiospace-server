import { betterAuth } from "better-auth";
import { mongodbAdapter } from "@better-auth/mongo-adapter";

export const createAuth = (database, client) => {
  return betterAuth({
    database: mongodbAdapter(database, {
      client,
    }),

    secret: process.env.BETTER_AUTH_SECRET,
    baseURL: process.env.BETTER_AUTH_URL,

    trustedOrigins: [
      "http://localhost:3000",
      ...(process.env.CLIENT_URL ? [process.env.CLIENT_URL] : []),
    ],

    emailAndPassword: {
      enabled: true,
      minPasswordLength: 6,
      requireEmailVerification: false,
      autoSignIn: true,
    },

    socialProviders: {
      google: {
        clientId: process.env.GOOGLE_CLIENT_ID,
        clientSecret: process.env.GOOGLE_CLIENT_SECRET,
        prompt: "select_account",
        scope: ["openid", "email", "profile"],
        overrideUserInfoOnSignIn: true,
        mapProfileToUser: (profile) => ({
          image: profile.picture,
        }),
      },
    },
  });
};