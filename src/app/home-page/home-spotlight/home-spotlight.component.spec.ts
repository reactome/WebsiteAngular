import { ComponentFixture, TestBed } from '@angular/core/testing';

import { HomeSpotlightComponent } from './home-spotlight.component';

describe('HomeSpotlightComponent', () => {
  let component: HomeSpotlightComponent;
  let fixture: ComponentFixture<HomeSpotlightComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [HomeSpotlightComponent]
    })
    .compileComponents();

    fixture = TestBed.createComponent(HomeSpotlightComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
