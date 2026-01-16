import { Component, Input } from '@angular/core';
import Article from '../../../types/article';
import { NgForOf, NgFor } from '@angular/common';

@Component({
  selector: 'app-home-latest-news',
  standalone: true,
  imports: [NgForOf, NgFor],
  templateUrl: './home-latest-news.component.html',
  styleUrl: './home-latest-news.component.scss'
})
export class HomeLatestNewsComponent {
  @Input() newsList: Article[] = [];
}
