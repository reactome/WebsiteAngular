# TinaCMS
TinaCMS is the content management system that Reactome is using for the majority of its pages and all of its articles. This document will instruct you on how to **add**, **edit** and **customize** TinaCMS pages.

### Important!!!
Before making any changes make sure your working git branch is up to date with origin/main. To do this run ````git pull```` or ````git fetch````.

## Adding a new page to Reactome from the Browser
Adding a page to Tina can be done in a few steps
1. **Choose where you are adding the page**  
Depending on whether you are adding an *about*, *content*, *documentation*, *tools*, *community*, *news*, *FAQ*, or *research spotlight* page will determine how you proceed.  

2. **Start your Reactome local dev environment**  
If you followed the ````documentation/local-environment.md```` tutorial run ````npm start````  
If you followed the ````documentation/local-environment-docker.md```` tutorial run ````docker compose up --build````  

3. **Navigate to /admin**
4. **Go to the collection you would like to add to**  
Find the "Navigation Menu" button and click on the *collection* you would like to add to.  
5. **Click Add File**
6. **Edit your page / article**  
Don't forget to set the DatePublished!  

7. **Click Save**
8. **Refresh your local environment**  
Stop it with ````^C```` and run again with the command from *Step 2*  

Your Page will now appear in your local environment. To publish it view the *publishing to github* portion of this tutorial.

## Editing a TinaCMS page from the Browser
To Edit a pre-existing page in your local dev environment follow the following steps.
1. **Start your Reactome local dev environment**  
If you followed the ````documentation/local-environment.md```` tutorial run ````npm start````  
If you followed the ````documentation/local-environment-docker.md```` tutorial run ````docker compose up --build````  
2. **Navigate to /admin**
3.  **Go to the collection you would like to edit from**  
Find the "Navigation Menu" button and click on the *collection* that the article you would like to edit is in.  
4. **Find your chosen article**
5. **Click on the ... menu and select Edit in Admin**
6. **Edit your page / article**  
7. **Click Save**  
   
8. **Refresh your local environment**  
Stop it with ````^C```` and run again with the command from *Step 1* 

Your edited page will now appear in your local environment. To publish your changes, view the *publishing to github* portion of this tutorial.

## Adding and Editing Pages Through mdx files
If you would prefer to use your own .md or .mdx file editor or do not wish to use a local dev environment -- you can instead edit the files directly.  

All articles and pages are stored in the ````projects/website-angular/content```` directory of this repository. Simply find the collection relevant to your page (i.e ````about/news```` for News articles) and add or edit the relevant files as you see fit.  

If you are adding net new files please follow these templates.  
For articles ````about/news````, ````content/reactome-research-spotlight```` or ````documentation/faq````:
````
---
title: <Title Here>
date: <YYYY-MM-DD>
author: <Author Here>
tags:
  - tag
image: /uploads/<upload path here>
---

<Article Body Here>
````  
For all other types of pages:
````
---
title: <Title Here>
description: <Description Here>
category: <about, content, documentation, tools, community, download>
image: /uploads/<upload path here>
---

<Body Here>
````  
  

## Publishing to Github
Once you are happy with your changes its time to publish them to github for review. This will require a github account so make sure you have one [here](https://github.com/login).  
Once you are ready run these commands from your clone of the repository.
````
git status
git switch -c <Your Article/Branch Name Here>
git push -u origin <Your Article/Branch Name Here>
````
Your branch is now available on the remote repository where you can make a pull request and have your article reviewed. Once everything has been approved the pull request (PR) can be merged into the working branch from which it can be put into the next release.  

If you are uncomfortable with command line there are convenient tools like the [VScode extension](https://marketplace.visualstudio.com/items?itemName=GitHub.vscode-github-actions) or [Github Desktop](https://www.gitkraken.com/download?_gl=1*u0whzn*_up*MQ..*_gs*MQ..&gclid=CjwKCAjwhLPOBhBiEiwA8_wJHPBQZEe_3tLOunlEc4lXI8wM8Wxgpov5AYK6cOdTyhM8m1IfV02dCRoCaXgQAvD_BwE) that can make things easier.

## Other Notes on TinaCMS
- If you ever have to edit the collections or general setup of TinaCMS that can be done in ````projects/website-angular/tina/config.ts````
- If you need to make a home / landing page for a collection (i.e *about/*, *content/*) just name the file ````index.mdx```` and place it in the correct folder
- Additional Information about TinaCMS can be found [here](https://tina.io/)