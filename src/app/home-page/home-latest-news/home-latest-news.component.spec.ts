import { ComponentFixture, TestBed } from '@angular/core/testing';

import { HomeLatestNewsComponent } from './home-latest-news.component';

describe('HomeLatestNewsComponent', () => {
  let component: HomeLatestNewsComponent;
  let fixture: ComponentFixture<HomeLatestNewsComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [HomeLatestNewsComponent]
    })
    .compileComponents();

    fixture = TestBed.createComponent(HomeLatestNewsComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
