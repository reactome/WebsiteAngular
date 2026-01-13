import { ComponentFixture, TestBed } from '@angular/core/testing';

import { HomeApiDataComponent } from './home-api-data.component';

describe('HomeApiDataComponent', () => {
  let component: HomeApiDataComponent;
  let fixture: ComponentFixture<HomeApiDataComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [HomeApiDataComponent]
    })
    .compileComponents();

    fixture = TestBed.createComponent(HomeApiDataComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
