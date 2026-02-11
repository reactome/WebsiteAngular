import { ComponentFixture, TestBed } from '@angular/core/testing';

import { HomeWhyReactomeComponent } from './home-why-reactome.component';

describe('HomeWhyReactomeComponent', () => {
  let component: HomeWhyReactomeComponent;
  let fixture: ComponentFixture<HomeWhyReactomeComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [HomeWhyReactomeComponent]
    })
    .compileComponents();

    fixture = TestBed.createComponent(HomeWhyReactomeComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
