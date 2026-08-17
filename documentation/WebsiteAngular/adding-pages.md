# Adding a Page to Reactome

The first thing to consider here is whether or not your page needs custom angular functionality. If the pages will be comprised of only text, images and video, a TinaCMS page will suffice and you can follow the TinaCMS tutorial instead.

To create a new angular page follow these steps

1. Generate a new component (this will be your page)  
   Follow the tutorial in adding-components
2. Add the route for your page in `projects/website-angular/src/app/app.routes.ts`  
   Your "route" is what makes your page show up at the correct address in the browser.
3. Add your page to `projects/website-angular/src/config/nav-options.json` so it appears in the navigation menus.
4. Edit your page to your hearts content.  
   This step will require a bit more creativity and Angular experience. I can't be sure what kind of page you are creating so do your best to get the functionality your need with the power of the internet on your side. I believe in you!
