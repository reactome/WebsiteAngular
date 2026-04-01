# Guide to Running Reactome as a Docker Container
This guide will instruct you in setting up Reactome in a Docker container!

## Step 1: Installing Docker
Docker is a containerization tool that allows you to run environments you may not have installed on your computer. You can install Docker by following these [instructions](https://docs.docker.com/get-started/get-docker/). Check that Docker has installed correctly by running ```docker --version```. If you see a version number, then everything is installed correctly.

## Step 2: Building and Running the Image
Once Docker has been installed, run the following command to prepare the local environment:
```
docker compose up --build
```

## Step 3: Explore Reactome!
Visit [http://localhost:4200/](http://localhost:4200/) to access the website.
You're all done! Good job.

Once finished with accessing the website, run the following command:
```
docker compose down
```
