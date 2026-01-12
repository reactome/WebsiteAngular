import { ComponentFixture, TestBed } from '@angular/core/testing';

import { copyrightFooterComponent } from './copyright-footer.component';

describe('copyrightFooterComponent', () => {
  let component: copyrightFooterComponent;
  let fixture: ComponentFixture<copyrightFooterComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [copyrightFooterComponent]
    })
    .compileComponents();

    fixture = TestBed.createComponent(copyrightFooterComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
