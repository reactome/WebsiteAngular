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
      { //About Pages
        name: "about",
        label: "About",
        path: "content/about",
        format: "mdx",
        fields: [
          { type: "string", name: "title", label: "Title", isTitle: true, required: true },
          { type: 'string', name: "description", label: "Description" },
          { type: 'string', name: "category", label: "Category", options: ["about", "content", "documentation", "tools", "community", "download"] }, //TODO: Downalod might not be needed
          { type: "rich-text", name: "body", label: "Body" },
          { type: 'image', name: "image", label: "Image" },
        ],
        ui: {
          router: ({ document }) => `/about/${document._sys.filename}`,
        }
      },
      { //News Articles
        name: "news",
        label: "News",
        path: "content/about/news",
        format: "mdx",
        fields: [
          { type: "string", name: "title", label: "Title", isTitle: true, required: true },
          { type: 'datetime', name: "date", label: "Date Published", required: true },
          { type: 'string', name: "author", label: "Author" },
          { type: "rich-text", name: "body", label: "Body", required: true },
          { type: 'string', name: "tags", label: "Tags", list: true },
          { type: 'image', name: "image", label: "Image" },
        ],
        ui: {
          router: ({ document }) => `/about/news/${document._sys.filename}`,
        }
      },
      { //Team Info
        name: "team",
        label: "Team",
        path: "content/about/team",
        format: "json",
        fields: [
          { type: "string", name: "name", label: "Name", isTitle: true, required: true },
          { type: "string", name: "role", label: "Role", required: true },
          {
            type: "string",
            name: "institution",
            label: "Institution",
            options: [
              "Ontario Institute for Cancer Research",
              "New York University Langone Medical Center",
              "European Bioinformatics Institute",
              "Oregon Health & Science University",
            ],
            required: true,
          },
           {
            type: "string",
            name: "type",
            label: "Member Type",
            options: ["principal_investigator", "current", "alumni"],
            required: true,
          },
        ]
      },
      { //Content Pages
        name: "content",
        label: "Content",
        path: "content/content",
        format: "mdx",
        fields: [
          { type: "string", name: "title", label: "Title", isTitle: true, required: true },
          { type: 'string', name: "description", label: "Description" },
          { type: 'string', name: "category", label: "Category", options: ["about", "content", "documentation", "tools", "community", "download"] }, //TODO: Downalod might not be needed
          { type: "rich-text", name: "body", label: "Body" },
          { type: 'image', name: "image", label: "Image" },
        ],
        ui: {
          router: ({ document }) => `/content/${document._sys.filename}`,
        }
      },
      {
        name: "reactome_research_spotlights",
        label: "Reactome Research Spotlights",
        path: "content/content/reactome-research-spotlight",
        format: "mdx",
        fields: [
          { type: "string", name: "title", label: "Title", isTitle: true, required: true },
          { type: 'datetime', name: "date", label: "Date Published" },
          { type: 'string', name: "author", label: "Author" },
          { type: "rich-text", name: "body", label: "Body" },
          { type: 'string', name: "tags", label: "Tags", list: true },
          { type: 'image', name: "image", label: "Image" },
        ],
        ui: {
          router: ({ document }) => `/content/reactome-research-spotlight/${document._sys.filename}`,
        }
      },
      { //Documentation Pages
        name: "documentation",
        label: "Documentation",
        path: "content/documentation",
        format: "mdx",
        fields: [
          { type: "string", name: "title", label: "Title", isTitle: true, required: true },
          { type: 'string', name: "description", label: "Description" },
          { type: 'string', name: "category", label: "Category", options: ["about", "content", "documentation", "tools", "community", "download"] }, //TODO: Downalod might not be needed
          { type: "rich-text", name: "body", label: "Body" },
          { type: 'image', name: "image", label: "Image" },
        ],
        ui: {
          router: ({ document }) => `/documentation/${document._sys.filename}`,
        }
      },
      { //Community Pages
        name: "community",
        label: "Community",
        path: "content/community",
        format: "mdx",
        fields: [
          { type: "string", name: "title", label: "Title", isTitle: true, required: true },
          { type: 'string', name: "description", label: "Description" },
          { type: 'string', name: "category", label: "Category", options: ["about", "content", "documentation", "tools", "community", "download"] }, //TODO: Downalod might not be needed
          { type: "rich-text", name: "body", label: "Body" },
          { type: 'image', name: "image", label: "Image" },
        ],
        ui: {
          router: ({ document }) => `/community/${document._sys.filename}`,
        }
      },
      

    ],
  },
  build: {
    outputFolder: "admin",
    publicFolder: "public",
  },
});
