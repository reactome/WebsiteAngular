import { ComponentFixture, TestBed } from '@angular/core/testing';

import { DropdownToggleComponent } from './dropdown-toggle.component';

describe('DropdownToggleComponent', () => {
  let component: DropdownToggleComponent;
  let fixture: ComponentFixture<DropdownToggleComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [DropdownToggleComponent]
    })
    .compileComponents();

    fixture = TestBed.createComponent(DropdownToggleComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
