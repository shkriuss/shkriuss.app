import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { encodeQr, penalty, QR_MAX_VERSION } from './qr.ts';

// Reference output from two independent encoders that agree on every one:
// python-qrcode 8.2, and segno 1.6.6 (with its extra padding byte removed; the
// standard only pads to the next byte). Level M, byte mode. For each text: the
// SHA-256 of every row of modules ("1" = dark) joined, for masks 0 to 7.
const REFERENCE: { text: string; version: number; hashes: string[] }[] = [
  {
    text: 'hello',
    version: 1,
    hashes: [
      '99ccedcf0d82e92a63894c8b42e405a3ac50eafa33ee2ce68fa895813fdcb386',
      '3a65a05e6cf988d628a155a076a843e7c3ca7fef24ed5a51615f5e837ec01308',
      '338c689e0fc5d63d4141c0bc4ca13017a9e3974f725d62a44c46f7de3cb4b170',
      'dfe75c4cc7ff735bed162390e7b29f91e0fd54be1949e70b531716db80d3f52b',
      '0fcaf6c571b275a0f81fff331195d7c18fbde16b12c0df0a6fdd5cd0c51e2b8b',
      'c06481974a364e0a1ad564d148d0278325efc47cf9b83c79ef0cbfab5da9c56d',
      'a1e177ca570facb32fe2727b853b4904897425062994440ef276fe92aed36112',
      '1193a98e9acd91c1a850105b67ec324d33ff4bfef4feb63262394e1ebfb46068',
    ],
  },
  {
    text: 'https://example.com/a-sixty-character-string-for-version-4',
    version: 4,
    hashes: [
      'b4303a5eb10cd806cecf958e14897ae3ddc73612a49de9fb7b5e9acfda24ebc8',
      'd2950d099457933a196d66f08f056758c5ab60677b3d0beea0462edcb4ebb67a',
      '24491ec38a2cd188a6991b44aa56610c8359a92637cd7fc9bda3c6fb931be669',
      '8536be953eaa2c3d5e47444610629bd46c86ca5a76ecaa2f6bc9db389578e6d8',
      'f7767bb4b10a9e76a01340f97dffbcf5e30d4f6375d786f2dfdaa60da4f72701',
      '85d38f5f96917f4bd94f4d310bdedc210c97f9819f8133f8a032cfa26ff9c5bd',
      '345f246d5a9463d3e249ed3cfdf22fbdc835ee55198c057c993ee4fc597b0c4e',
      '6b3a8c88ffc79b9a72ec598d8c326fa06804aed85a3f322d0de6c6624e4746a7',
    ],
  },
  {
    text: 'https://shkriuss.app/account/#link=AAAAAAAAAAAAAAAAAAAAAA.BBBBBBBBBBBBBBBBBBBB',
    version: 5,
    hashes: [
      '5cfd8e71a5ed73e9d1893779f72992e0ef2d711e57463b660688b03365c4c17b',
      'd460b18c52dd768ae94acd871f797082d04c670e35983e1c09213f74de50db47',
      'a73501801213b3180d9b28d43d87d453250c1e21c77c0075dc1c58eb74585685',
      '3e86ea344a3b7b920f70155bcb0fc36c7c7b1f81cae144c2dd75e17446f32e4d',
      'f163716fe595689af98ed95c35d9b847b3e4c78e41ceb9b8415cdcef0e1bdb8e',
      'ff87032257abae1e77f9b5fb0a94309225208aba59552caa6bede668ffe19355',
      '85921f4961fdcaac29ec293c9ff21ead37e7d1b2a8d8e0b303cc519c4fc463a1',
      '2a8040049eb6f707df9672b682643d20efa3847e8ded92b2f60dae43d4b27ab2',
    ],
  },
  {
    text: 'https://shkriuss.app/account/#link=Zm9vYmFyYmF6cXV4MTIzNA.0123456789abcdefghijklmnopqrstuvwxyzABCDEFG',
    version: 6,
    hashes: [
      'cfa4a7cadfad9396111df0fe3b44443e9d7c4d9ccade65c383ae85d4b793530a',
      'fad8d33ccc6264d50e023e436e4803a6605446fd86600f5882f56b9a0233d769',
      'b0e68d78a73b5a547668b29e9550864e27c7e5b675d198a5a033ece38db04992',
      '0c8411c901d6f16db0abb77f1999c8ed4e0b6cdfb264b031eddeffb7f8b0d102',
      '11ad38620f1b812f59a4819ab323c645347018fe96fcdaed6d1d39e087e83fc4',
      '23fb48d153e9ef9aa72fd5dced3eff4e42d1655ee50784479be2bd3e4fa5e6bd',
      '0650ea7d768eb6494050f6b78cb12f97a4bf31208f13d23ec892eb43e51bc32b',
      '6195b085265d531c12deb2d03fcc9c983d294686231a40c98eb237ab29caaa22',
    ],
  },
  {
    text: 'https://pr-123-hub.shkriuss.workers.dev/account/#link=Zm9vYmFyYmF6cXV4MTIzNA.0123456789abcdefghijklmnopqrstuvwxyzABCDEFG',
    version: 7,
    hashes: [
      '9ff7d176f9fb00864b245ea2eae07488c9ef59f6a211e8f027d3f1b58f1d09cf',
      'e22513fb2fdcb6962c3a4c04e01d07caf2ed01593eb9ba0474040290ba097856',
      'cc41bd819d563c1b2c4ac4a0aadfbd70a51bff26b395dddc22da80f0834a8289',
      '59cd36f64a6a2f164be8a7eada495c7626f38f31cbcca8e9c8336b1dfb2ae0db',
      '11c5c57fde46b9dac956fea655a9fee4702b5e560ad70444a218500e515d1389',
      'c9817911b173fb4d63cf02644bee6d2c6f3967e0a9e9943422ba3f144cc9b19b',
      '0c890835d776d8f802ec68982b6002967f437b7cc6b2445130fd096b42f843b8',
      'ca417ca7a7fb7367d6d621fbdc37374c41cf96407137cd8710cb85902c18d291',
    ],
  },
  {
    text: 'x'.repeat(213),
    version: 10,
    hashes: [
      'f673820bb5ccd3f0f6035d879c98fa30d6d1f03153cace0b9a23da4e0a681a53',
      '49c766b08955c9c8eef67f7a47bc597beee8d5e337cec35bf2db9876761aaf01',
      'a94ef70302ec15cf157db87f6639aef0151cddbf505f87f92d17d39a5f985765',
      'c0aa0b25790b38444fced97feb2e4a7287564d5848789b90c8d9d222d5c62024',
      '6f815bc194f8b22254427b6079665a7bb56c04ee6a4df6914d884bce82410a11',
      '69da6e1c84df89831613c45143eb0ee8549c1c3b7d1f881c9a8534fc44d7095b',
      'a13d96a96ecd2464629af1e4ff23d3eda15b756eb99f6fd1e0e0a5e0426e26c8',
      'c44713135d3b5be0f177f5eca6ecab815381352119d666111bbce98d91c31f08',
    ],
  },
  {
    text: 'Grüße, 日本 ✓',
    version: 2,
    hashes: [
      'a03b5f5ff0e7fea5e9eec40e003a4746fd07a9d2712215527529086635268722',
      '4095356e834633ad59928d307687a4d7114d98102ed99215dc4e847059776278',
      'b40f1ac9e5f23ae7e10a082fd17731e86fe19e8e9a3f11d677e75ff1e8662a00',
      '73056c59fd893eb0c4b5d4fa8f4532ea2af03dcf717e82a347042985523a7641',
      'e31d8a9b32a0e73115719f143d22caf7173f2dc08b464d686069850da2fcecd4',
      'ebf30f0046c7db8e9af69949389391b75463eb2899b1168321839189b66bdbc8',
      '79f928dfa74a27234629514fde317ff9d19ab93b7c0aae7b0610510f073de964',
      '5ad28c710b939200370f481c81ddebbbdd5f93ce56a3204b34b32f230a0d0522',
    ],
  },
];

/** "hello" with mask 2, row by row, from the same reference. */
const HELLO_MASK_2 = [
  '111111100000001111111',
  '100000100101101000001',
  '101110101011101011101',
  '101110101010101011101',
  '101110101010101011101',
  '100000101001001000001',
  '111111101010101111111',
  '000000001010000000000',
  '101111100011001111100',
  '111010010011111001101',
  '011010100000101101110',
  '000011010001111001100',
  '010100111100100100001',
  '000000001110100101001',
  '111111100101010010110',
  '100000101010000111110',
  '101110101101010010010',
  '101110101101111101000',
  '101110101000101100100',
  '100000100101111011100',
  '111111101000100010010',
];

const rowsOf = (modules: boolean[][]) =>
  modules.map((row) => row.map((dark) => (dark ? '1' : '0')).join(''));
const hashOf = (modules: boolean[][]) =>
  createHash('sha256').update(rowsOf(modules).join('')).digest('hex');

describe('encodeQr', () => {
  it('matches the reference module for module ("hello", mask 2)', () => {
    const code = encodeQr('hello', { mask: 2 });
    expect(code).toMatchObject({ version: 1, size: 21, mask: 2 });
    expect(rowsOf(code.modules)).toEqual(HELLO_MASK_2);
  });

  it.each(REFERENCE)(
    'matches the reference for every mask: $version',
    ({ text, version, hashes }) => {
      hashes.forEach((hash, mask) => {
        const code = encodeQr(text, { mask });
        expect(code.version, 'smallest version that fits').toBe(version);
        expect(code.size).toBe(version * 4 + 17);
        expect(hashOf(code.modules), `mask ${mask}`).toBe(hash);
      });
    },
  );

  it('picks the mask with the lowest penalty', () => {
    for (const { text } of REFERENCE) {
      const best = encodeQr(text);
      const scores = [0, 1, 2, 3, 4, 5, 6, 7].map((mask) =>
        penalty(encodeQr(text, { mask }).modules),
      );
      expect(penalty(best.modules)).toBe(Math.min(...scores));
    }
  });

  it('refuses text that is too long', () => {
    expect(() => encodeQr('x'.repeat(214))).toThrow(RangeError);
    expect(() => encodeQr('x'.repeat(30), { version: 1 })).toThrow(RangeError);
    expect(encodeQr('x'.repeat(213)).version).toBe(QR_MAX_VERSION);
  });
});
