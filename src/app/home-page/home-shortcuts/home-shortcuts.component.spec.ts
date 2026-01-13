import { ComponentFixture, TestBed } from '@angular/core/testing';

import { HomeShortcutsComponent } from './home-shortcuts.component';

describe('HomeShortcutsComponent', () => {
  let component: HomeShortcutsComponent;
  let fixture: ComponentFixture<HomeShortcutsComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [HomeShortcutsComponent]
    })
    .compileComponents();

    fixture = TestBed.createComponent(HomeShortcutsComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
