# Guide to Setting up Reactome as a local Environment
**Hello and welcome to the local environment installation guide!**  
In an effort to minimize the suffering of all who come here after me I will do my best to assume no pre-exsisting knowledge on github or Angular development.  

Feel free to skip ahead if you have already completed some of these steps!

## Step 1: Installing git
If you are rolling your eyes at the pedantry of this guide please skip to the next step.  
  
In order to get a local version of Reactome on your computer, you will need to get the code onto your computer. We will be doing this with the command line tool git which you can install for Windows, Linux or MacOS [here](https://git-scm.com/install/).
  
Once git is installed clone and enter the repository with the following commands:  
````
git clone https://github.com/reactome/WebsiteAngular.git
cd WebsiteAngular
````  
this will place a local copy of the project onto you computer and open the folder containing it.
  

## Step 2: Installing Node
Node is the tool that will compile and run the Reactome project. You can download it [here](https://nodejs.org/en/download)!  
Once node is installed run the following commands in the ````WebsiteAngular/```` directory.

````
npm install --legacy-peer-deps
npm start
````

After this you should have a fully functional copy of Reactome running on your computer.   

If you run into any issues, try your best to follow any instructions in the error message or any advice found online.

# Step 3: Rejoice!
Nothing to do here but reap the benefits of your hard work I guess? Why are you still reading this.