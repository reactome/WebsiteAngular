import { Component, Input } from '@angular/core';
import { NewsIndexItem } from '../../../types/article';
import { NgForOf, NgFor } from '@angular/common';
import formatDate from '../../../utils/formatDate';

@Component({
  selector: 'app-home-latest-news',
  standalone: true,
  imports: [NgForOf, NgFor],
  templateUrl: './home-latest-news.component.html',
  styleUrl: './home-latest-news.component.scss'
})
export class HomeLatestNewsComponent {
  @Input() newsList: NewsIndexItem[] = [];

  formatD(date: Date): string {
    return formatDate(date);
  }
}
