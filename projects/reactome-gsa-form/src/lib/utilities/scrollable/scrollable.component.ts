import { AfterViewInit, ChangeDetectionStrategy, Component, input, OnDestroy, signal, viewChild, inject } from '@angular/core';
import {ScrollService} from "../../services/scroll.service";
import {UntilDestroy, untilDestroyed} from "@ngneat/until-destroy";
import {map} from "rxjs";
import {TourUtilsService} from "../../services/tour-utils.service";
import {HeightService} from "../../services/height.service";
import {CdkScrollable} from "@angular/cdk/scrolling";

@UntilDestroy()
@Component({
  selector: 'gsa-scrollable',
  templateUrl: './scrollable.component.html',
  styleUrls: ['./scrollable.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: false
})
export class ScrollableComponent implements AfterViewInit, OnDestroy {
  private scrollService = inject(ScrollService);
  tour = inject(TourUtilsService);
  height = inject(HeightService);

  readonly topMargin = input<number>(2);
  readonly bottomMargin = input<number>(2);
  readonly name = input<string>('');
  readonly innerClasses = input<string>('');
  readonly scrollable = viewChild.required('scrollable', {read: CdkScrollable});

  observer = new ResizeObserver(() => {
      this.updateShadows()
      this.updateShadows(100)
  })
  tourVisible = this.tour.state$.pipe(map(state => state === 'on'))

  readonly shadows = {top: signal(false), bottom: signal(true)};

  constructor() {
    this.scrollService.resize$.pipe(untilDestroyed(this)).subscribe(() => this.updateShadows());
  }

  ngAfterViewInit() {
    this.updateShadows();
    this.observer.observe(this.scrollable().getElementRef().nativeElement)
  }

  ngOnDestroy(): void {
    this.observer.disconnect();
  }

  scrolling() {
    this.updateShadows();
  }

  public updateShadows(delay = 0) {
    setTimeout(() => {
      this.shadows.top.set(this.scrollable().measureScrollOffset('top') > this.topMargin())
      this.shadows.bottom.set(this.scrollable().measureScrollOffset('bottom') > this.bottomMargin())
    }, delay)
  }
}
