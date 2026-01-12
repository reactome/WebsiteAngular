import { ComponentFixture, TestBed } from '@angular/core/testing';

import { CiteUsComponent } from './cite-us.component';

describe('CiteUsComponent', () => {
  let component: CiteUsComponent;
  let fixture: ComponentFixture<CiteUsComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [CiteUsComponent]
    })
    .compileComponents();

    fixture = TestBed.createComponent(CiteUsComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
