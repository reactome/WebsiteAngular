const fs = require("fs-extra");
const concat = require("concat");

const build = async () => {
  const files = [
    "./dist/reactome-table-wc/browser/main.js",
    "./dist/reactome-table-wc/browser/polyfills.js"
  ]

  await fs.ensureDir('web-component-demo');
  await concat(files, "web-component-demo/reactome-table-wc.js");
  await fs.copy("./dist/reactome-table-wc/browser/styles.css", "web-component-demo/reactome-table-styles.css");
  await fs.copy("./projects/reactome-table/src/assets/fonts/RobotoMono.ttf", "web-component-demo/RobotoMono.ttf")
  console.log("Files concatenated successfully!");
}

build();
