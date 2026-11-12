import type { SampleScene } from "./model";

/**
 * Generated from scripts/fixtures/verify-family-sky.json by buildSampleScene.
 * Fixture people only. Regenerate with the sample scene builder; do not hand-edit names.
 */
export const SAMPLE_SCENE: SampleScene = {
  "note": "Fixture. Not a real family.",
  "focusPersonId": "fx-ada",
  "people": [
    {
      "id": "fx-ada",
      "name": "Ada Fixture",
      "givenName": "Ada",
      "initials": "AF",
      "hue": 204,
      "unitId": "fu-fx-ada",
      "generation": 0,
      "lx": -0.418,
      "ly": 0.737
    },
    {
      "id": "fx-ben",
      "name": "Ben Fixture",
      "givenName": "Ben",
      "initials": "BF",
      "hue": 204,
      "unitId": "fu-fx-ada",
      "generation": 0,
      "lx": 0.418,
      "ly": 0.737
    },
    {
      "id": "fx-cora",
      "name": "Cora Fixture",
      "givenName": "Cora",
      "initials": "CF",
      "hue": 170,
      "unitId": "fu-fx-ada",
      "generation": 1,
      "lx": 0,
      "ly": -0.883
    },
    {
      "id": "fx-eli",
      "name": "Eli Fixture",
      "givenName": "Eli",
      "initials": "EF",
      "hue": 52,
      "unitId": "fu-fx-dee",
      "generation": 1,
      "lx": 0.418,
      "ly": 0.737
    },
    {
      "id": "fx-dee",
      "name": "Dee Fixture",
      "givenName": "Dee",
      "initials": "DF",
      "hue": 268,
      "unitId": "fu-fx-dee",
      "generation": 1,
      "lx": -0.418,
      "ly": 0.737
    },
    {
      "id": "fx-fay",
      "name": "Fay Fixture",
      "givenName": "Fay",
      "initials": "FF",
      "hue": 196,
      "unitId": "fu-fx-dee",
      "generation": 2,
      "lx": 0,
      "ly": -0.883
    },
    {
      "id": "fx-gran",
      "name": "Gran Fixture",
      "givenName": "Gran",
      "initials": "GF",
      "hue": 60,
      "unitId": "fu-fx-gran",
      "generation": 0,
      "lx": -0.418,
      "ly": 0.737
    },
    {
      "id": "fx-mae",
      "name": "Mae Fixture",
      "givenName": "Mae",
      "initials": "MF",
      "hue": 12,
      "unitId": "fu-fx-gran",
      "generation": 1,
      "lx": -0.418,
      "ly": -0.883
    },
    {
      "id": "fx-stu",
      "name": "Stu Fixture",
      "givenName": "Stu",
      "initials": "SF",
      "hue": 228,
      "unitId": "fu-fx-gran",
      "generation": 1,
      "lx": 0.418,
      "ly": -0.883
    },
    {
      "id": "fx-nia",
      "name": "Nia Fixture",
      "givenName": "Nia",
      "initials": "NF",
      "hue": 220,
      "unitId": "fu-fx-nia",
      "generation": 2,
      "lx": -0.418,
      "ly": -0.073
    },
    {
      "id": "fx-pal",
      "name": "Pal Fixture",
      "givenName": "Pal",
      "initials": "PF",
      "hue": 20,
      "unitId": "fu-fx-nia",
      "generation": 2,
      "lx": 0.418,
      "ly": -0.073
    },
    {
      "id": "fx-wynn",
      "name": "Wynn Fixture",
      "givenName": "Wynn",
      "initials": "WF",
      "hue": 296,
      "unitId": "fu-fx-wynn",
      "generation": 2,
      "lx": 0,
      "ly": -0.073
    },
    {
      "id": "fx-rex",
      "name": "Rex Fixture",
      "givenName": "Rex",
      "initials": "RF",
      "hue": 52,
      "unitId": "fu-fx-rex",
      "generation": 0,
      "lx": 0,
      "ly": -0.073
    }
  ],
  "families": [
    {
      "id": "fu-fx-ada",
      "label": "Ada & Ben",
      "memberIds": [
        "fx-ada",
        "fx-ben",
        "fx-cora"
      ],
      "headIds": [
        "fx-ada",
        "fx-ben"
      ],
      "generation": 0,
      "x": -3.2,
      "y": 1.785,
      "z": 0,
      "radius": 0.607,
      "hue": 204
    },
    {
      "id": "fu-fx-dee",
      "label": "Dee & Eli",
      "memberIds": [
        "fx-eli",
        "fx-dee",
        "fx-fay"
      ],
      "headIds": [
        "fx-dee",
        "fx-eli"
      ],
      "generation": 1,
      "x": -3.2,
      "y": -1.785,
      "z": 2.2,
      "radius": 0.607,
      "hue": 268
    },
    {
      "id": "fu-fx-gran",
      "label": "Gran",
      "memberIds": [
        "fx-gran",
        "fx-mae",
        "fx-stu"
      ],
      "headIds": [
        "fx-gran"
      ],
      "generation": 0,
      "x": 1.071,
      "y": 1.785,
      "z": 0,
      "radius": 0.634,
      "hue": 60
    },
    {
      "id": "fu-fx-nia",
      "label": "Nia & Pal",
      "memberIds": [
        "fx-nia",
        "fx-pal"
      ],
      "headIds": [
        "fx-nia",
        "fx-pal"
      ],
      "generation": 2,
      "x": 1.068,
      "y": -0.97,
      "z": 4.4,
      "radius": 0.58,
      "hue": 220
    },
    {
      "id": "fu-fx-wynn",
      "label": "Wynn",
      "memberIds": [
        "fx-wynn"
      ],
      "headIds": [
        "fx-wynn"
      ],
      "generation": 2,
      "x": 3.2,
      "y": -0.97,
      "z": 4.4,
      "radius": 0.58,
      "hue": 296
    },
    {
      "id": "fu-fx-rex",
      "label": "Rex",
      "memberIds": [
        "fx-rex"
      ],
      "headIds": [
        "fx-rex"
      ],
      "generation": 0,
      "x": -1.064,
      "y": -0.97,
      "z": 0,
      "radius": 0.58,
      "hue": 52
    }
  ],
  "links": [
    {
      "id": "fx-c-cora:fx-ada",
      "fromId": "fx-ada",
      "toId": "fx-cora",
      "kind": "blood"
    },
    {
      "id": "fx-c-cora:fx-ben",
      "fromId": "fx-ben",
      "toId": "fx-cora",
      "kind": "blood"
    },
    {
      "id": "fx-c-eli:fx-ada",
      "fromId": "fx-ada",
      "toId": "fx-eli",
      "kind": "blood"
    },
    {
      "id": "fx-c-eli:fx-ben",
      "fromId": "fx-ben",
      "toId": "fx-eli",
      "kind": "blood"
    },
    {
      "id": "fx-c-fay:fx-dee",
      "fromId": "fx-dee",
      "toId": "fx-fay",
      "kind": "blood"
    },
    {
      "id": "fx-c-fay:fx-eli",
      "fromId": "fx-eli",
      "toId": "fx-fay",
      "kind": "blood"
    },
    {
      "id": "fx-c-mae:fx-gran",
      "fromId": "fx-gran",
      "toId": "fx-mae",
      "kind": "blood"
    },
    {
      "id": "fx-c-nia:fx-stu",
      "fromId": "fx-stu",
      "toId": "fx-nia",
      "kind": "step"
    },
    {
      "id": "fx-c-wynn:fx-stu",
      "fromId": "fx-stu",
      "toId": "fx-wynn",
      "kind": "step"
    },
    {
      "id": "fx-c-eli-rex:fx-rex",
      "fromId": "fx-rex",
      "toId": "fx-eli",
      "kind": "blood"
    },
    {
      "id": "fx-u-ab",
      "fromId": "fx-ada",
      "toId": "fx-ben",
      "kind": "partner"
    },
    {
      "id": "fx-u-de",
      "fromId": "fx-dee",
      "toId": "fx-eli",
      "kind": "partner"
    },
    {
      "id": "fx-u-ms",
      "fromId": "fx-mae",
      "toId": "fx-stu",
      "kind": "partner"
    },
    {
      "id": "fx-u-np",
      "fromId": "fx-nia",
      "toId": "fx-pal",
      "kind": "partner"
    }
  ],
  "partners": {
    "fx-ada": [
      "fx-ben"
    ],
    "fx-ben": [
      "fx-ada"
    ],
    "fx-cora": [],
    "fx-eli": [
      "fx-dee"
    ],
    "fx-dee": [
      "fx-eli"
    ],
    "fx-fay": [],
    "fx-gran": [],
    "fx-mae": [
      "fx-stu"
    ],
    "fx-stu": [
      "fx-mae"
    ],
    "fx-nia": [
      "fx-pal"
    ],
    "fx-pal": [
      "fx-nia"
    ],
    "fx-wynn": [],
    "fx-rex": []
  },
  "parents": {
    "fx-ada": [],
    "fx-ben": [],
    "fx-cora": [
      "fx-ada",
      "fx-ben"
    ],
    "fx-eli": [
      "fx-ada",
      "fx-ben",
      "fx-rex"
    ],
    "fx-dee": [],
    "fx-fay": [
      "fx-dee",
      "fx-eli"
    ],
    "fx-gran": [],
    "fx-mae": [
      "fx-gran"
    ],
    "fx-stu": [],
    "fx-nia": [
      "fx-stu"
    ],
    "fx-pal": [],
    "fx-wynn": [
      "fx-stu"
    ],
    "fx-rex": []
  },
  "children": {
    "fx-ada": [
      "fx-cora",
      "fx-eli"
    ],
    "fx-ben": [
      "fx-cora",
      "fx-eli"
    ],
    "fx-cora": [],
    "fx-eli": [
      "fx-fay"
    ],
    "fx-dee": [
      "fx-fay"
    ],
    "fx-fay": [],
    "fx-gran": [
      "fx-mae"
    ],
    "fx-mae": [],
    "fx-stu": [
      "fx-nia",
      "fx-wynn"
    ],
    "fx-nia": [],
    "fx-pal": [],
    "fx-wynn": [],
    "fx-rex": [
      "fx-eli"
    ]
  }
};
