import { defineConfig } from "tinacms";

const branch =
  process.env['TINA_BRANCH'] ||
  process.env['VERCEL_GIT_COMMIT_REF'] ||
  "main";

export default defineConfig({
  clientId: process.env['TINA_CLIENT_ID'] || "",
  token: process.env['TINA_TOKEN'] || "",
  branch,
  media: {
    tina: {
      mediaRoot: "uploads",
      publicFolder: "public",
    },
  },
  schema: {
    collections: [
      { //Various pages like About, Help, Cite Us, etc.
        name: "pages",
        label: "Pages",
        path: "content/pages",
        format: "mdx",
        fields: [
          { type: "string", name: "title", label: "Title", isTitle: true, required: true },
          { type: 'string', name: "description", label: "Description" },
          { type: 'string', name: "category", label: "Category", options: ["about", "content", "documentation", "tools", "community", "download"] }, //TODO: Downalod might not be needed
          { type: "rich-text", name: "body", label: "Body" },
        ],
        ui: {
          router: ({ document }) => `/pages/${document._sys.filename}`,
        }
      },
      {
        name: "news",
        label: "News",
        path: "content/news",
        format: "mdx",
        fields: [
          { type: "string", name: "title", label: "Title", isTitle: true, required: true },
          { type: 'datetime', name: "date", label: "Date Published" },
          { type: 'string', name: "author", label: "Author" },
          { type: "rich-text", name: "body", label: "Body" },
          { type: 'string', name: "tags", label: "Tags", list: true },
        ],
        ui: {
          router: ({ document }) => `about/news/${document._sys.filename}`,
        }
      }

    ],
  },
  build: {
    outputFolder: "admin",
    publicFolder: "public",
  },
});
