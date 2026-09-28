import { Component, input } from '@angular/core';
@Component({
  selector: 'cr-logger',
  imports: [],
  template: '',
})
export class LoggerComponent {
  readonly toLog = input<any>();

  constructor() {}
}
