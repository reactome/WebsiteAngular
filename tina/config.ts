import { defineConfig } from "tinacms";

const branch =
  process.env.TINA_BRANCH ||
  process.env.VERCEL_GIT_COMMIT_REF ||
  "main";

export default defineConfig({
  clientId: process.env.TINA_CLIENT_ID || "",
  token: process.env.TINA_TOKEN || "",
  branch,
  media: {
    tina: {
      mediaRoot: "uploads",
      publicFolder: "public",
    },
  },
  schema: {
    collections: [
      {
        name: "pages",
        label: "Pages",
        path: "content/pages",
        format: "md",
        fields: [
          { type: "string", name: "title", label: "Title" },
          { type: "rich-text", name: "body", label: "Body" },
        ],
      },
    ],
  },
  build: {
    outputFolder: "admin",
    publicFolder: "public",
  },
});
