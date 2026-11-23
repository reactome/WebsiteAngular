import { Injectable, inject } from '@angular/core';
import { Title } from '@angular/platform-browser';
import { RouterStateSnapshot, TitleStrategy } from '@angular/router';

/** The site's name, last in every title, and the home page's title. */
export const SITE = 'Reactome';
export const HOME_TITLE = 'Reactome Pathway Knowledgebase';

/**
 * A page's title: what it shows, most specific first, then the site's name
 * ("Apoptosis (R-HSA-109581) · Reactome"). Every page was titled "Reactome",
 * so every tab, bookmark and search result read the same.
 */
export function pageTitle(...parts: (string | null | undefined)[]): string {
  const named = parts.map((part) => part?.trim()).filter((part): part is string => !!part);
  return [...named, SITE].join(' · ');
}

/**
 * Sets a route's `title` as the page's, at each navigation; a route with none
 * gets the site's name until its page, once its data arrives, names itself
 * (an article, a pathway, a search).
 */
@Injectable()
export class ReactomeTitleStrategy extends TitleStrategy {
  private readonly title = inject(Title);

  override updateTitle(snapshot: RouterStateSnapshot): void {
    const own = this.buildTitle(snapshot);
    this.title.setTitle(own === HOME_TITLE ? HOME_TITLE : pageTitle(own));
  }
}
