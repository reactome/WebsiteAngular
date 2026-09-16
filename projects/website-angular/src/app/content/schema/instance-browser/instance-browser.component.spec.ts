import { TestBed } from '@angular/core/testing';
import { ChangeDetectorRef } from '@angular/core';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting, HttpTestingController } from '@angular/common/http/testing';
import { InstanceBrowserComponent } from './instance-browser.component';

// A Figure holds nothing but the path of an image file, so the path is the
// whole instance: as plain text it tells a curator that a file is named, but
// not whether it is the right picture or whether it is there at all. These
// tests pin that the path is carried as a link to the image itself.
//
// Row building only, not rendering: this component has an external templateUrl
// and cannot be compiled under the vitest setup (see vitest.config.ts).
describe('InstanceBrowserComponent figure links', () => {
  let httpTesting: HttpTestingController;

  const NOT_A_DATABASE_OBJECT = [{ databaseObject: false }];

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        // Constructed directly rather than via createComponent, as in
        // schema.component.spec.ts: there is no host view, and hence no
        // node-level ChangeDetectorRef to inject.
        {
          provide: ChangeDetectorRef,
          useValue: { markForCheck: () => {}, detectChanges: () => {} },
        },
      ],
    });
    httpTesting = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    try {
      httpTesting.verify();
    } finally {
      // Must run even when verify throws, or the failure cascades into every
      // later test as "test module has already been instantiated".
      TestBed.resetTestingModule();
    }
  });

  /** Load one instance, answering the three requests the component makes. */
  function load(instance: any, attributes: { name: string }[]) {
    const component = TestBed.runInInjectionContext(() => new InstanceBrowserComponent());
    component.instanceId = instance.dbId;
    component.ngOnChanges({ instanceId: { firstChange: true } as any });

    httpTesting
      .expectOne((r) => r.url.endsWith(`/query/enhanced/${instance.dbId}`))
      .flush(instance);
    httpTesting.expectOne((r) => r.url.endsWith(`/instance/${instance.dbId}/referrers`)).flush([]);
    httpTesting
      .expectOne((r) => r.url.endsWith(`/${instance.schemaClass}/attributes`))
      .flush(attributes.map((a) => ({ ...a, valueTypes: NOT_A_DATABASE_OBJECT })));

    return component;
  }

  function valuesOf(component: InstanceBrowserComponent, attribute: string) {
    return component.rows.find((row) => row.name === attribute)?.values;
  }

  it('offers the url of a figure as a link to the image file', () => {
    const component = load(
      {
        dbId: 975561,
        displayName: '/figures/12_GlcNAc2Man9PPDol.png',
        url: '/figures/12_GlcNAc2Man9PPDol.png',
        className: 'Figure',
        schemaClass: 'Figure',
      },
      [{ name: 'displayName' }, { name: 'url' }]
    );

    // Root-relative and left exactly as the database stores it -- the template
    // uses it as the href -- so the image is fetched from whichever origin
    // serves the page: localhost behind the dev server's /figures proxy, the
    // site itself once deployed.
    expect(valuesOf(component, 'url')).toEqual([
      { type: 'figure', text: '/figures/12_GlcNAc2Man9PPDol.png' },
    ]);
  });

  it('leaves a url that is not a figure path as text', () => {
    const component = load(
      {
        dbId: 1,
        displayName: 'UniProt',
        url: 'https://www.uniprot.org',
        schemaClass: 'ReferenceDatabase',
      },
      [{ name: 'url' }]
    );

    expect(valuesOf(component, 'url')).toEqual([{ type: 'text', text: 'https://www.uniprot.org' }]);
  });

  it('does not take the bare /figures/ directory for an image', () => {
    const component = load({ dbId: 2, url: '/figures/', schemaClass: 'Figure' }, [{ name: 'url' }]);

    expect(valuesOf(component, 'url')).toEqual([{ type: 'text', text: '/figures/' }]);
  });
});
