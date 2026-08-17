# Changing Styles

Hey!!! Are you here because you think my work is ugly?! Not cool.  
Jokes aside here is your guide to changing the look of anything on the website.

## SCSS

[SCSS](https://sass-lang.com/) is the framework we use for _styling_ (assigning visual traits to HTML tags) in this repository.

## Changing or Adding Styles

For the sake of simplicity I will guide you through a basic tutorial on changing the style of an element which will hopefully be applicable to whatever you are trying to do.

1. Find class you are trying to restyle on the page (or add a _class_ to the component)  
   For this tutorial we will use the copyright text at the bottom of the Reactome page ` © 2026 Reactome`.
1. Use right click and select _Inspect_ on the component you want to change  
   This will open up the _inspector_ menu and allow you to see the base HTML of the page. We can see here that the _class_ for the box the the copyright text is in is named `copyright`.
1. Find the class definition in a SCSS file (or make one)
   It would help if you already know the file you're working in but if you don't then use a text-search function to match text or class name until you find the correct file. In this case `projects/website-angular/src/app/copyright-footer/copyright-footer.component.scss`.
1. Edit the style
   Now that we have found the _copyright_ class definition we can change it as we see fit. To change the colour of the copyright box. Replace the `.copyright` section with this.

```
.copyright {
  display: flex;
  flex: 1;
  flex-direction: row;
  align-items: center;
  justify-content: flex-start;
  gap: 4px;
  color: pink;
  background-color: pink; #change this line
}
```

Now you have all the skills you need to change styles wherever you like! Go forth and style away.
