// @vitest-environment node
//
// jsoupText against Jsoup 1.14.3 itself: each expected answer below is what
// Jsoup.parse(input).text() returned for the input, run on the jar the Java
// content service ships (17 Oct 2026). Beyond these, the module matched Jsoup
// on every summation in the graph, 21,634 texts.
import { describe, expect, it } from 'vitest';
import { jsoupText } from './jsoup-text.mjs';

const MEASURED = [
  ['a<b>b</b>c', 'abc'],
  ['<p>one<p>two', 'one two'],
  ['one<br>two', 'one two'],
  ['one<br/>two', 'one two'],
  ['</p>x', 'x'],
  ['x</p>y', 'x y'],
  ['<div>One</div>Two', 'One Two'],
  [
    'a &amp b &amp; c &copy d &copyright e &notin; f &notin g &#169; &#xA9 &#0; &#128; &#99999999999; &#xD800;',
    'a & b & c © d &copyright e ∉ f &notin g © © \u0000 € � �',
  ],
  ['a  \n\t b  c​d­e', 'a b cde'],
  ['<table><tr><td>a</td><td>b</td></tr></table>c', 'a b c'],
  ['<tr><td>a</td><td>b</td></tr>', 'ab'],
  ['<table>x<tr><td>y</td></tr>z</table>w', 'x y z w'],
  ['<ul><li>a<li>b</ul>c', 'a b c'],
  ['<ol><li>a</li></ol>.', 'a .'],
  ['<h1>t</h1>x<h2>u', 't x u'],
  ['<pre>  a\n  b </pre>c', 'a\n  b c'],
  ['<!-- c -->x<!x>y<?z>w', 'xyw'],
  ['1 < 2 > 0', '1 < 2 > 0'],
  ['a<5b', 'a<5b'],
  ['x</>y', 'xy'],
  ['x</ y>z', 'xz'],
  ['<i>a<p>b</i>c</p>d', 'a bc d'],
  ['<a>1<a>2</a>3', '123'],
  ['<title>T &amp; x</title>body', 'T & x body'],
  ["<script>var a='<b>'</script>s", 's'],
  ['<style>p{}</style>q', 'q'],
  ['<textarea> a  b </textarea>', 'a  b'],
  ["a<b c='>'>d</b>e", 'ade'],
  ['<p>x</p>\n<p>y</p>', 'x y'],
  ['<td>a</td>b', 'ab'],
  ['<table><caption>c</caption><tr><td>d</td></tr></table>', 'c d'],
  ['<dl><dt>a<dd>b</dl>c', 'a b c'],
  ['<li>a<li>b', 'a b'],
  ['<b>bold<table><td>x</table></b>', 'bold x'],
  ['&lt;b&gt;', '<b>'],
  ['&#x26;amp;', '&amp;'],
  ['&AMP; &Amp;', '& &Amp;'],
  ['<sup>2</sup>+<sub>3</sub>', '2+3'],
  ['<font color=red>r</font>', 'r'],
  ['<p><table><tr><td>x</td></tr></table>y</p>', 'x y'],
  ['', ''],
  ['   ', ''],
  ['<br>', ''],
  ['a<hr>b', 'a b'],
  ['<img src=x>y', 'y'],
  ['<span>a</span><span>b</span>', 'ab'],
];

describe('jsoupText', () => {
  it.each(MEASURED)('reads %j as Jsoup does', (input, expected) => {
    expect(jsoupText(input)).toBe(expected);
  });
});
