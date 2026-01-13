import { ComponentFixture, TestBed } from '@angular/core/testing';

import { HomeRelatedComponent } from './home-related.component';

describe('HomeRelatedComponent', () => {
  let component: HomeRelatedComponent;
  let fixture: ComponentFixture<HomeRelatedComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [HomeRelatedComponent]
    })
    .compileComponents();

    fixture = TestBed.createComponent(HomeRelatedComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
