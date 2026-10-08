import {test,expect} from 'bun:test';
import {parseSegments,plainText,DEFAULT_SPEECH_RULES} from '../src/shared';
import {locateText,normalizeText} from '../src/highlight';

test('Threadbare inline gasp preserves the entire dialogue and following narration',()=>{
  const segments=parseSegments('She paused. "Wait. <gasp> You heard that too?" He nodded.','Mara');
  expect(segments.map(s=>s.text).join(' ')).toBe('She paused. "Wait. <gasp> You heard that too?" He nodded.');
  expect(segments.map(s=>s.speaker)).toEqual(['narrator','Mara','Mara','narrator']);
  expect(plainText('"Wait. <gasp> You heard that too?"')).toBe('"Wait. You heard that too?"');
});
test('Threadbare vocal menu, aliases and multiword events survive prose wrappers',()=>{
  const menu='laugh laughter chuckle chuckles giggle snicker cackle cheer gasp sigh sighs groan grunt grr growl hiss moan pant pff phew tsk whispers whispering shout argh whimper cry sob scream shriek snort breath exhales cough throat-clearing sneeze yawn'.split(' ').concat(['heavy breath','short pause','long pause']);
  for(const name of menu) {
    const raw=`<font color="blue">"Before <${name}> after."</font> Then she waited.`;
    expect(parseSegments(raw,'Mara').map(s=>s.text)).toEqual([`"Before <${name}> after."`,'Then she waited.']);
    expect(plainText(raw)).toBe('"Before after." Then she waited.');
  }
});
test('recognized vocal tokens are normalized without acting as XML containers',()=>{
  expect(parseSegments('"A <GASP/> B <heavy   breath> C <short pause> D."','Mara')[0].text).toBe('"A <gasp> B <heavy breath> C <short pause> D."');
  expect(plainText('A <gasp> B <long pause> C')).toBe('A B C');
});
test('vocal events inside hidden blocks, comments and code remain excluded',()=>{
  expect(parseSegments('Before. <scenecard><gasp> Hidden. </scenecard><dt-image>"<laugh> Photo."</dt-image> `"<sigh> Code."` <!-- <cry> --> After.','Mara').map(s=>s.text)).toEqual(['Before.','After.']);
});
test('vocal-looking tags with attributes do not bypass metadata exclusion',()=>{
  expect(plainText('Before. <gasp request="hidden">Private text.</gasp> After.')).toBe('Before. After.');
});
test('dialogue marker matches rendered text with the vocal token hidden',()=>{
  const segments=parseSegments('“Wait. <gasp> You heard that too?”','Mara');
  const rendered=normalizeText('“Wait.  You heard that too?”');
  expect(segments).toHaveLength(2);
  const first=locateText(rendered,plainText(segments[0].text))!;
  expect(first).not.toBeNull();
  const next=locateText(rendered,plainText(segments[1].text),first.offset+first.length)!;
  expect(next.offset).toBeGreaterThan(first.offset);
});

const controls=`<flair scene="clear" light="monitor" mood="exposed"></flair>
<flair-choice>Cross the room and hand him the phone</flair-choice>
<flair-choice>Turn the screen around from where you stand</flair-choice>
<flair-choice>Put the phone face-down on the table</flair-choice>
<scenecard>
<sc-scene><time>9:51 AM</time><location>Jason's Apartment</location><mood>Violated intimacy</mood></sc-scene>
<sc-user><attire>Jeans, trainers, bare chest</attire><place>At kitchen table, 8 feet away</place><doing>Staring at the synced surveillance photo</doing></sc-user>
<sc-cast><sc-char><name>Elys-04</name><role>Imprinted android</role><mood>Curious, yielding</mood><attire>Maid dress, stockings</attire><goal>See the downloaded photo</goal><place>At computer desk</place><doing>Waiting for permission</doing></sc-char></sc-cast>
<sc-stella>[speaker:Elys-04][emotion:angry] A commentary that includes "Good" and should never be spoken.</sc-stella>
</scenecard>
<lumidraw-parse request="generate"></lumidraw-parse>`;

test('scene cards, flair choices and image controls are entirely silent',()=>{
  expect(parseSegments(controls,'Elys-04')).toEqual([]);
  expect(plainText(controls)).toBe('');
});
test('hidden blocks cannot change the voice or emotion of surrounding prose',()=>{
  const segments=parseSegments('He covered the screen. '+controls+' The room was quiet. “Here you go.”','Elys-04');
  expect(segments.map(s=>[s.text,s.speaker,s.emotion])).toEqual([
    ['He covered the screen.','narrator',''],['The room was quiet.','narrator',''],['“Here you go.”','Elys-04',''],
  ]);
});
test('image prompts in custom extension tags are excluded before quote detection',()=>{
  const raw='The door opened. <dt-image aspect="portrait">Close-up photo, 85mm lens. "Look at the camera."</dt-image><lumidraw>Another photo prompt.</lumidraw><lumi-studio-prompt>[speaker:Photographer] Perfect! Hold that pose.</lumi-studio-prompt> He smiled.';
  expect(parseSegments(raw,'Elys-04').map(s=>s.text)).toEqual(['The door opened.','He smiled.']);
});
test('nested custom tags inside ordinary HTML prose keep only the prose',()=>{
  expect(plainText('<div><p>The <strong>door</strong> opened.</p><scenecard><div>Hidden <scenecard>nested</scenecard> fields.</div></scenecard><p>He waited.</p></div>')).toBe('The door opened. He waited.');
});
test('rendered utility cards delimited by UI comments are silent',()=>{
  expect(plainText('Before. <!-- UI_START --><div><p>STATUS: "Hidden."</p></div><!-- UI_END --> After.')).toBe('Before. After.');
  expect(plainText('Before. <!-- UI_START --><div>Unfinished hidden card.')).toBe('Before.');
});
test('case, self-closing controls and quoted angle brackets in attributes are supported',()=>{
  expect(plainText('Before. <SCENECARD title="a > b"><sc-user>Hidden</sc-user></SCENECARD><lumidraw-parse request="generate"/><FLAIR mood="a > b"/> After.')).toBe('Before. After.');
});
test('unclosed metadata and partial trailing tags cannot be spoken',()=>{
  expect(plainText('Before. <scenecard><sc-stella>Hidden forever.')).toBe('Before.');
  expect(plainText('Before. <lumidraw-parse request="generate"')).toBe('Before.');
  expect(plainText('Before. <scenecard')).toBe('Before.');
});
test('void tags, comments and code do not swallow the next prose',()=>{
  expect(plainText('Before. <img src="x"><input value="Hidden"><meta name="hidden"><!-- "Hidden." --> `Hidden code.` After.')).toBe('Before. After.');
  expect(plainText('Before. ```xml\n<scenecard>Hidden</scenecard>\n``` After.')).toBe('Before. After.');
  expect(plainText('Before. ```unfinished code')).toBe('Before.');
});
test('entities support spoken prose and escaped hidden metadata',()=>{
  expect(parseSegments('<p>He nodded. &ldquo;Hello.&rdquo; &amp; goodbye.</p>','Elys-04').map(s=>s.speaker)).toEqual(['narrator','Elys-04','narrator']);
  expect(plainText('A &lt;scenecard&gt;hidden&lt;/scenecard&gt; B &#39;word&#39; &#x1f642; &#x110000;')).toBe("A B 'word' 🙂 &#x110000;");
});
test('ordinary comparisons, link labels and bracketed prose remain readable',()=>{
  expect(plainText('2 < 3 and a > b. [the garden](https://example.com) [a quiet thought]')).toBe('2 < 3 and a > b. the garden [a quiet thought]');
});
test('speaker cues cannot override skipped native spans',()=>{
  const rules={...DEFAULT_SPEECH_RULES,asterisked:'skip' as const,quoted:'skip' as const};
  expect(parseSegments('*[speaker:Elys-04] Hidden action.* “[speaker:Elys-04] Hidden dialogue.” Visible prose.','Elys-04',rules).map(s=>s.text)).toEqual(['Visible prose.']);
  expect(parseSegments('*[speaker:Other][emotion:angry] Hidden action.* “Hello.”','Elys-04',{...DEFAULT_SPEECH_RULES,asterisked:'skip'})[0]).toMatchObject({speaker:'Elys-04',emotion:''});
});
