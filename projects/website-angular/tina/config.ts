import { defineConfig } from 'tinacms';

const branch = process.env['TINA_BRANCH'] || process.env['VERCEL_GIT_COMMIT_REF'] || 'main';

export default defineConfig({
  clientId: process.env['TINA_CLIENT_ID'] || '',
  token: process.env['TINA_TOKEN'] || '',
  branch,
  media: {
    tina: {
      mediaRoot: 'uploads',
      publicFolder: 'public',
    },
  },
  schema: {
    collections: [
      {
        //About Pages
        name: 'about',
        label: 'About',
        path: 'content/about',
        format: 'mdx',
        match: {
          exclude: 'news/**',
        },
        // ui.router intentionally omitted -- see 'news' collection below.
        fields: [
          { type: 'string', name: 'title', label: 'Title', isTitle: true, required: true },
          { type: 'string', name: 'description', label: 'Description' },
          {
            type: 'string',
            name: 'category',
            label: 'Category',
            options: ['about', 'content', 'documentation', 'tools', 'community', 'download'],
          },
          { type: 'rich-text', name: 'body', label: 'Body', isBody: true },
          { type: 'image', name: 'image', label: 'Image' },
        ],
      },
      {
        //News Articles
        name: 'news',
        label: 'News',
        path: 'content/about/news',
        format: 'mdx',
        // ui.router is intentionally omitted. Defining it makes the admin
        // list's title-click route to a visual-edit iframe that only
        // surfaces form fields when the embedded page calls TinaCMS's
        // useTina() hook. Our Angular pages don't (no Tina React
        // integration), so the iframe shows the live page with an empty
        // form panel and editors can't reach the fields. Without router,
        // the title-click opens the form-only admin editor directly --
        // same form the kebab menu's "Edit in Admin" option opens.
        fields: [
          { type: 'string', name: 'title', label: 'Title', isTitle: true, required: true },
          { type: 'datetime', name: 'date', label: 'Date Published', required: true },
          { type: 'string', name: 'author', label: 'Author' },
          { type: 'rich-text', name: 'body', label: 'Body', isBody: true, required: true },
          { type: 'string', name: 'tags', label: 'Tags', list: true },
          { type: 'image', name: 'image', label: 'Image' },
        ],
      },
      {
        //Content Pages
        name: 'content',
        label: 'Content',
        path: 'content/content',
        format: 'mdx',
        match: {
          exclude: 'reactome-research-spotlight/**',
        },
        // ui.router intentionally omitted -- see 'news' collection above.
        fields: [
          { type: 'string', name: 'title', label: 'Title', isTitle: true, required: true },
          { type: 'string', name: 'description', label: 'Description' },
          {
            type: 'string',
            name: 'category',
            label: 'Category',
            options: ['about', 'content', 'documentation', 'tools', 'community', 'download'],
          },
          { type: 'rich-text', name: 'body', label: 'Body', isBody: true },
          { type: 'image', name: 'image', label: 'Image' },
        ],
      },
      {
        name: 'reactome_research_spotlights',
        label: 'Reactome Research Spotlights',
        path: 'content/content/reactome-research-spotlight',
        format: 'mdx',
        // ui.router intentionally omitted -- see 'news' collection above.
        fields: [
          { type: 'string', name: 'title', label: 'Title', isTitle: true, required: true },
          { type: 'datetime', name: 'date', label: 'Date Published' },
          { type: 'string', name: 'author', label: 'Author' },
          { type: 'rich-text', name: 'body', label: 'Body', isBody: true },
          { type: 'string', name: 'tags', label: 'Tags', list: true },
          { type: 'image', name: 'image', label: 'Image' },
        ],
      },
      {
        //Documentation Pages
        name: 'documentation',
        label: 'Documentation',
        path: 'content/documentation',
        format: 'mdx',
        // ui.router intentionally omitted -- see 'news' collection above.
        fields: [
          { type: 'string', name: 'title', label: 'Title', isTitle: true, required: true },
          { type: 'string', name: 'description', label: 'Description' },
          {
            type: 'string',
            name: 'category',
            label: 'Category',
            options: ['about', 'content', 'documentation', 'tools', 'community', 'download'],
          },
          { type: 'rich-text', name: 'body', label: 'Body', isBody: true },
          { type: 'image', name: 'image', label: 'Image' },
        ],
      },
      {
        name: 'faq',
        label: 'FAQ',
        path: 'documentation/faq',
        format: 'mdx',
        fields: [
          { type: 'string', name: 'question_id', label: 'Question ID', required: true },
          { type: 'string', name: 'question', label: 'Question', isTitle: true, required: true },
          { type: 'rich-text', name: 'answer', label: 'Answer', isBody: true, required: true },
          { type: 'string', name: 'related_links', label: 'Related Links', list: true },
        ],
      },
      {
        //Community Pages
        name: 'community',
        label: 'Community',
        path: 'content/community',
        format: 'mdx',
        // ui.router intentionally omitted -- see 'news' collection above.
        fields: [
          { type: 'string', name: 'title', label: 'Title', isTitle: true, required: true },
          { type: 'string', name: 'description', label: 'Description' },
          {
            type: 'string',
            name: 'category',
            label: 'Category',
            options: ['about', 'content', 'documentation', 'tools', 'community', 'download'],
          },
          { type: 'rich-text', name: 'body', label: 'Body', isBody: true },
          { type: 'image', name: 'image', label: 'Image' },
        ],
      },
    ],
  },
  build: {
    outputFolder: 'admin',
    publicFolder: 'public',
  },
});
