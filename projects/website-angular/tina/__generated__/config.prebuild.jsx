// projects/website-angular/tina/config.ts
import { defineConfig } from "tinacms";
var branch = process.env["TINA_BRANCH"] || process.env["VERCEL_GIT_COMMIT_REF"] || "main";
var config_default = defineConfig({
  clientId: process.env["TINA_CLIENT_ID"] || "",
  token: process.env["TINA_TOKEN"] || "",
  branch,
  media: {
    tina: {
      mediaRoot: "uploads",
      publicFolder: "public"
    }
  },
  schema: {
    collections: [
      {
        //About Pages
        name: "about",
        label: "About",
        path: "content/about",
        format: "mdx",
        match: {
          exclude: "news/**"
        },
        fields: [
          { type: "string", name: "title", label: "Title", isTitle: true, required: true },
          { type: "string", name: "description", label: "Description" },
          { type: "string", name: "category", label: "Category", options: ["about", "content", "documentation", "tools", "community", "download"] },
          { type: "rich-text", name: "body", label: "Body", isBody: true },
          { type: "image", name: "image", label: "Image" }
        ],
        ui: {
          router: ({ document }) => `/about/${document._sys.filename}`
        }
      },
      {
        //News Articles
        name: "news",
        label: "News",
        path: "content/about/news",
        format: "mdx",
        fields: [
          { type: "string", name: "title", label: "Title", isTitle: true, required: true },
          { type: "datetime", name: "date", label: "Date Published", required: true },
          { type: "string", name: "author", label: "Author" },
          { type: "rich-text", name: "body", label: "Body", isBody: true, required: true },
          { type: "string", name: "tags", label: "Tags", list: true },
          { type: "image", name: "image", label: "Image" }
        ],
        ui: {
          router: ({ document }) => `/about/news/${document._sys.filename}`
        }
      },
      {
        //Content Pages
        name: "content",
        label: "Content",
        path: "content/content",
        format: "mdx",
        fields: [
          { type: "string", name: "title", label: "Title", isTitle: true, required: true },
          { type: "string", name: "description", label: "Description" },
          { type: "string", name: "category", label: "Category", options: ["about", "content", "documentation", "tools", "community", "download"] },
          { type: "rich-text", name: "body", label: "Body", isBody: true },
          { type: "image", name: "image", label: "Image" }
        ],
        ui: {
          router: ({ document }) => `/content/${document._sys.filename}`
        }
      },
      {
        name: "reactome_research_spotlights",
        label: "Reactome Research Spotlights",
        path: "content/content/reactome-research-spotlight",
        format: "mdx",
        fields: [
          { type: "string", name: "title", label: "Title", isTitle: true, required: true },
          { type: "datetime", name: "date", label: "Date Published" },
          { type: "string", name: "author", label: "Author" },
          { type: "rich-text", name: "body", label: "Body", isBody: true },
          { type: "string", name: "tags", label: "Tags", list: true },
          { type: "image", name: "image", label: "Image" }
        ],
        ui: {
          router: ({ document }) => `/content/reactome-research-spotlight/${document._sys.filename}`
        }
      },
      {
        //Documentation Pages
        name: "documentation",
        label: "Documentation",
        path: "content/documentation",
        format: "mdx",
        fields: [
          { type: "string", name: "title", label: "Title", isTitle: true, required: true },
          { type: "string", name: "description", label: "Description" },
          { type: "string", name: "category", label: "Category", options: ["about", "content", "documentation", "tools", "community", "download"] },
          { type: "rich-text", name: "body", label: "Body", isBody: true },
          { type: "image", name: "image", label: "Image" }
        ],
        ui: {
          router: ({ document }) => `/documentation/${document._sys.filename}`
        }
      },
      {
        name: "faq",
        label: "FAQ",
        path: "documentation/faq",
        format: "mdx",
        fields: [
          { type: "string", name: "question_id", label: "Question ID", required: true },
          { type: "string", name: "question", label: "Question", isTitle: true, required: true },
          { type: "rich-text", name: "answer", label: "Answer", isBody: true, required: true },
          { type: "string", name: "related_links", label: "Related Links", list: true }
        ]
      },
      {
        //Community Pages
        name: "community",
        label: "Community",
        path: "content/community",
        format: "mdx",
        fields: [
          { type: "string", name: "title", label: "Title", isTitle: true, required: true },
          { type: "string", name: "description", label: "Description" },
          { type: "string", name: "category", label: "Category", options: ["about", "content", "documentation", "tools", "community", "download"] },
          { type: "rich-text", name: "body", label: "Body", isBody: true },
          { type: "image", name: "image", label: "Image" }
        ],
        ui: {
          router: ({ document }) => `/community/${document._sys.filename}`
        }
      }
    ]
  },
  build: {
    outputFolder: "admin",
    publicFolder: "public"
  }
});
export {
  config_default as default
};
