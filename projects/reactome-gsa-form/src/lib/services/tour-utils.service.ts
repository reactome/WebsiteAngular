import { Injectable, inject } from '@angular/core';
import { TourService } from 'ngx-ui-tour-md-menu';
import { map, merge, Observable, shareReplay, startWith } from 'rxjs';
import { UntilDestroy, untilDestroyed } from '@ngneat/until-destroy';
// ngx-ui-tour-md-menu publishes this interface under the name IStepOption
// (`export type { IMdStepOption as IStepOption }`); it is the same type.
import { IStepOption as IMdStepOption } from 'ngx-ui-tour-md-menu';

export type TourStatus = 'on' | 'off' | 'pause';

@UntilDestroy()
// Deliberately not providedIn: 'root'. This service injects TourService, and a
// root-scoped service can only resolve root-scoped dependencies -- which would
// force provideUiTour() into the root ApplicationConfig and drag ngx-ui-tour +
// ngx-ui-tour-core (~275 kB) into the initial bundle. Provided by GsaFormModule
// instead, so both resolve inside the lazily loaded Pathway Browser.
@Injectable()
export class TourUtilsService {
  private tourService = inject(TourService);

  on: boolean = false;
  paused: boolean = false;

  state$: Observable<TourStatus> = merge(
    this.tourService.start$.pipe(map(() => 'on')) as Observable<TourStatus>,
    this.tourService.end$.pipe(map(() => 'off')) as Observable<TourStatus>,
    this.tourService.pause$.pipe(map(() => 'pause')) as Observable<TourStatus>,
    this.tourService.resume$.pipe(map(() => 'on')) as Observable<TourStatus>
  ).pipe(startWith('off' as TourStatus), shareReplay(1));

  constructor() {
    this.tourService.setDefaults({
      placement: { yPosition: 'above', xPosition: 'after' },
      enableBackdrop: false,
      smoothScroll: true,
      centerAnchorOnScroll: true,
      disablePageScrolling: true,
      closeOnOutsideClick: false,
      duplicateAnchorHandling: 'registerFirst',
      showArrow: false,
    });

    this.tourService.start$.pipe(untilDestroyed(this)).subscribe(() => {
      this.on = true;
      this.paused = false;
    });
    this.tourService.end$.pipe(untilDestroyed(this)).subscribe(() => {
      this.on = false;
      this.paused = false;
    });
    this.tourService.pause$.pipe(untilDestroyed(this)).subscribe(() => (this.paused = true));
    this.tourService.resume$.pipe(untilDestroyed(this)).subscribe(() => (this.paused = false));
  }

  end() {
    this.tourService.end();
  }

  hasNext(step: IMdStepOption): boolean {
    return this.tourService.hasNext(step);
  }

  next() {
    this.tourService.next();
  }

  pause() {
    this.tourService.pause();
  }

  resume() {
    this.tourService.resume();
  }

  start() {
    this.tourService.start();
  }
}
