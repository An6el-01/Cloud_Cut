export interface SvgDimensions {
  width: number;
  height: number;
  unit: string;
}

export interface ExpectedDimensions {
  sku: string;
  width: number; // in mm
  height: number; // in mm
}

export interface ValidationResult {
  isValid: boolean;
  actualDimensions: SvgDimensions;
  expectedDimensions: ExpectedDimensions;
  dimensionDifference: {
    widthDiff: number;
    heightDiff: number;
    widthDiffPercent: number;
    heightDiffPercent: number;
  };
  recommendations: string[];
}

// Known dimensions for each insert SKU (in mm)
export const EXPECTED_DIMENSIONS: Record<string, ExpectedDimensions> = {
  'SFI-MPORG2-01': { sku: 'SFI-MPORG2-01', width: 208.394, height: 328.352 },
  'SFI-MPORG2-02': { sku: 'SFI-MPORG2-02', width: 208.394, height: 328.352 },
  'SFI-MPORG2-03': { sku: 'SFI-MPORG2-03', width: 55.321, height: 299.157 },
  'SFI-FSYS12': { sku: 'SFI-FSYS12', width: 384.702, height: 280.852 },
  'SFI-FSOR13': { sku: 'SFI-FSOR13', width: 345.831, height: 268.014 },
  'SFI-MMC-01': { sku: 'SFI-MMC-01', width: 121, height: 362 },
  'SFI-MMC-02': { sku: 'SFI-MMC-02', width: 130, height: 362 },
  'SFI-MTC2': { sku: 'SFI-MTC2', width: 512.375, height: 349.547 },
  'SFI-MTCB2': { sku: 'SFI-MTCB2', width: 517.561, height: 300.855 },
  'SFI-MTO2': { sku: 'SFI-MTO2', width: 519.415, height: 292.272 },
  'SFI-HAMT2-01': { sku: 'SFI-HAMT2-01', width: 552, height: 382 },
  'SFI-HAMT2-02': { sku: 'SFI-HAMT2-02', width: 548, height: 377 },
  'SFI-BLBX2': { sku: 'SFI-BLBX2', width: 430.894, height: 316.560 },
  'SFI-BLBXOG2': { sku: 'SFI-BLBXOG2', width: 403.008, height: 312.782 },
  'SFI-BLSBX2': { sku: 'SFI-BLSBX2', width: 401, height: 312 },
  'SFI-BLST2': { sku: 'SFI-BLST2', width: 340.78, height: 273.105 },
  'SFI-BWBX2': { sku: 'SFI-BWBX2', width: 412.153, height: 317.563 },
  'SFI-CLO2': { sku: 'SFI-CLO2', width: 489.12, height: 289.11 },
  'SFI-DORG2': { sku: 'SFI-DORG2', width: 413.42, height: 305.93 },
  'SFI-DTS2DHT2': { sku: 'SFI-DTS2DHT2', width: 318, height: 212 },
  'SFI-DTS2T2': { sku: 'SFI-DTS2T2', width: 437.772, height: 282.686 },
  'SFI-DTS2802': { sku: 'SFI-DTS2802', width: 487, height: 281 },
  'SFI-DTS3002': { sku: 'SFI-DTS3002', width: 484.116, height: 278 },
  'SFI-DTSB2': { sku: 'SFI-DTSB2', width: 418.688, height: 296.172 },
  'SFI-DTSD2': { sku: 'SFI-DTSD2', width: 344.914, height: 281.587 },
  'SFI-DTSDXL12': { sku: 'SFI-DTSDXL12', width: 645, height: 471 },
  'SFI-DTSO2': { sku: 'SFI-DTSO2', width: 421.641, height: 282.464 },
  'SFI-DTSRTB2': { sku: 'SFI-DTSRTB2', width: 482.45, height: 315.837 },
  'SFI-DTSYS2CB2': { sku: 'SFI-DTSYS2CB2', width: 329.893, height: 209.738 },
  'SFI-DTSYS2FO-01': { sku: 'SFI-DTSYS2FO-01', width: 224.94, height: 336 },
  'SFI-DTSYS2FO-02': { sku: 'SFI-DTSYS2FO-02', width: 224.94, height: 336 },
  'SFI-DTSYS2FO-03': { sku: 'SFI-DTSYS2FO-03', width: 38.479, height: 299.513 },
  'SFI-DTSYS2HO2': { sku: 'SFI-DTSYS2HO2', width: 333.52, height: 213.12 },
  'SFI-DTSYS2RTB2': { sku: 'SFI-DTSYS2RTB2', width: 508, height: 340.766 },
  'SFI-DTSYS2TB2': { sku: 'SFI-DTSYS2TB2', width: 488, height: 310 },
  'SFI-DTSYSA2': { sku: 'SFI-DTSYSA2', width: 476.11, height: 305.15 },
  'SFI-DTSYSB2': { sku: 'SFI-DTSYSB2', width: 482, height: 286.366 },
  'SFI-DTSYSD2': { sku: 'SFI-DTSYSD2', width: 452, height: 284 },
  'SFI-DTSYSD3': { sku: 'SFI-DTSYSD3', width: 452, height: 284 },
  'SFI-DTSYSO2': { sku: 'SFI-DTSYSO2', width: 459.127, height: 277.13 },
  'SFI-EECL2': { sku: 'SFI-EECL2', width: 412, height: 261 },
  'SFI-EECS2': { sku: 'SFI-EECS2', width: 422.336, height: 282.856 },
  'SFI-FSPBO2-01': { sku: 'SFI-FSPBO2-01', width: 194, height: 342.058 },
  'SFI-FSPBO2-02': { sku: 'SFI-FSPBO2-02', width: 50.294, height: 338 },
  'SFI-FSPBO2-03': { sku: 'SFI-FSPBO2-03', width: 194, height: 342.058 },
  'SFI-FSPD2': { sku: 'SFI-FSPD2', width: 424, height: 295 },
  'SFI-FSPDO2-01': { sku: 'SFI-FSPDO2-01', width: 534.3, height: 213.5 },
  'SFI-FSPDO2-02': { sku: 'SFI-FSPDO2-02', width: 530, height: 105 },
  'SFI-FSPMB2': { sku: 'SFI-FSPMB2', width: 499.16, height: 339.5 },
  'SFI-FSPRB2': { sku: 'SFI-FSPRB2', width: 530.35, height: 324.07 },
  'SFI-FSPSO2': { sku: 'SFI-FSPSO2', width: 349.57, height: 201.54 },
  'SFI-FSPTB2': { sku: 'SFI-FSPTB2', width: 534.07, height: 337.89 },
  'SFI-FSYS3L2': { sku: 'SFI-FSYS3L2', width: 496.3, height: 290.82 },
  'SFI-FSYS3XXL': { sku: 'SFI-FSYS3XXL', width: 786, height: 285 },
  'SFI-FSYSM2': { sku: 'SFI-FSYSM2', width: 258.40, height: 162 },
  'SFI-GTL-PVROCK-01': { sku: 'SFI-GTL-PVROCK-01', width: 74, height: 440 },
  'SFI-GTL-PVROCK-02': { sku: 'SFI-GTL-PVROCK-02', width: 74, height: 440 },
  'SFI-GTL-PVROCK-03': { sku: 'SFI-GTL-PVROCK-03', width: 468.3, height: 350 },
  'SFI-GTL-PVROCK-04': { sku: 'SFI-GTL-PVROCK-04', width: 468.3, height: 370 },
  'SFI-HHIT2': { sku: 'SFI-HHIT2', width: 387.5, height: 282.4 },
  'SFI-HIKCMB2': { sku: 'SFI-HIKCMB2', width: 507.7, height: 330 },
  'SFI-HIKCSB2': { sku: 'SFI-HIKCSB2', width: 498.49, height: 353 },
  'SFI-HIKCT-01': { sku: 'SFI-HIKCT-01', width: 523.172, height: 261.542 },
  'SFI-HIKCT-02': { sku: 'SFI-HIKCT-02', width: 523.172, height: 383.2 },
  'SFI-HL2': { sku: 'SFI-HL2', width: 942, height: 297 },
  'SFI-HLWRHC2': { sku: 'SFI-HLWRHC2', width: 942, height: 297 },
  'SFI-HPHC2': { sku: 'SFI-HPHC2', width: 315, height: 235 },
  'SFI-HSKBOTC2': { sku: 'SFI-HSKBOTC2', width: 510, height: 338.72 },
  'SFI-HSKCLO2': { sku: 'SFI-HSKCLO2', width: 471.5, height: 258 },
  'SFI-HSKCO-01': { sku: 'SFI-HSKCO-01', width: 473, height: 255 },
  'SFI-HSKCO-02': { sku: 'SFI-HSKCO-02', width: 474, height: 234 },
  'SFI-HSKD2': { sku: 'SFI-HSKD2', width: 436, height: 250 },
  'SFI-HSKT-01': { sku: 'SFI-HSKT-01', width: 480, height: 224.6 },
  'SFI-HSKT-02': { sku: 'SFI-HSKT-02', width: 480, height: 253 },
  'SFI-HSKTB2': { sku: 'SFI-HSKTB2', width: 475, height: 263.385 },
  'SFI-HXL2': { sku: 'SFI-HXL2', width: 1302, height: 333.98 },
  'SFI-HXLWRHC2': { sku: 'SFI-HXLWRHC2', width: 1310.2, height: 340 },
  'SFI-JCBSSV2TB2': { sku: 'SFI-JCBSSV2TB2', width: 515, height: 295 },
  'SFI-JCBSSV2TC2': { sku: 'SFI-JCBSSV2TC2', width: 510.15, height: 320.615 },
  'SFI-JCBSSV2TO2': { sku: 'SFI-JCBSSV2TO2', width: 515, height: 290 },
  'SFI-JCBSSV22': { sku: 'SFI-JCBSSV22', width: 515, height: 290 },
  'SFI-KMBCBFW-01': { sku: 'SFI-KMBCBFW-01', width: 242, height: 336.76 },
  'SFI-KMBCBFW-02': { sku: 'SFI-KMBCBFW-02', width: 242, height: 336.76 },
  'SFI-KMBCBHW2': { sku: 'SFI-KMBCBHW2', width: 245, height: 331 },
  'SFI-KMBMRB-01': { sku: 'SFI-KMBMRB-01', width: 496, height: 288.37 },
  'SFI-KMBMRB-02': { sku: 'SFI-KMBMRB-02', width: 496, height: 328.37 },
  'SFI-KMBMTB2': { sku: 'SFI-KMBMTB2', width: 490, height: 343 },
  'SFI-KMBSDT3-01': { sku: 'SFI-KMBSDT3-01', width: 140, height: 320 },
  'SFI-KMBSDT3-02': { sku: 'SFI-KMBSDT3-02', width: 140, height: 320 },
  'SFI-KMBSDT3-03': { sku: 'SFI-KMBSDT3-03', width: 414, height: 320 },
  'SFI-KMBSTB2': { sku: 'SFI-KMBSTB2', width: 508, height: 348.225 },
  'SFI-KTRSNR2DT2': { sku: 'SFI-KTRSNR2DT2', width: 360, height: 271.5 },
  'SFI-KTRSNRFO-01': { sku: 'SFI-KTRSNRFO-01', width: 218.5, height: 306 },
  'SFI-KTRSNRFO-02': { sku: 'SFI-KTRSNRFO-02', width: 218.5, height: 306 },
  'SFI-KTRSNRHO2': { sku: 'SFI-KTRSNRHO2', width: 218, height: 307 },
  'SFI-KTRSNRMC2': { sku: 'SFI-KTRSNRMC2', width: 457, height: 284 },
  'SFI-KTRSNRTB2': { sku: 'SFI-KTRSNRTB2', width: 462, height: 299 },
  'SFI-KTRSNRTC2': { sku: 'SFI-KTRSNRTC2', width: 467.956, height: 302.826 },
  'SFI-MC1DTC2': { sku: 'SFI-MC1DTC2', width: 420, height: 325 },
  'SFI-MCLOR2': { sku: 'SFI-MCLOR2', width: 457.53, height: 305 },
  'SFI-MFC12': { sku: 'SFI-MFC12', width: 427.827, height: 322 },
  'SFI-MM145L2': { sku: 'SFI-MM145L2', width: 477.647, height: 281.039 },
  'SFI-MMBX2': { sku: 'SFI-MMBX2', width: 380, height: 266.446 },
  'SFI-MMP2': { sku: 'SFI-MMP2', width: 379.865, height: 282.269 },
  'SFI-MMPCL2': { sku: 'SFI-MMPCL2', width: 350, height: 247 },
  'SFI-MMPDL2': { sku: 'SFI-MMPDL2', width: 349, height: 283 },
  'SFI-MMPDM2': { sku: 'SFI-MMPDM2', width: 172, height: 283 },
  'SFI-MMTDCO2': { sku: 'SFI-MMTDCO2', width: 318, height: 211.581 },
  'SFI-MMTDMO2': { sku: 'SFI-MMTDMO2', width: 493, height: 338 },
  'SFI-MMTLPMO2': { sku: 'SFI-MMTLPMO2', width: 493, height: 338 },
  'SFI-MMTLT2': { sku: 'SFI-MMTLT2', width: 457.999, height: 306 },
  'SFI-MMTLTB2': { sku: 'SFI-MMTLTB2', width: 740.177, height: 480 },
  'SFI-MMTMTB2': { sku: 'SFI-MMTMTB2', width: 493, height: 338 },
  'SFI-MMTRTC-01': { sku: 'SFI-MMTRTC-01', width: 672.8, height: 422.751 },
  'SFI-MMTRTC-02': { sku: 'SFI-MMTRTC-02', width: 742.812, height: 483.290 },
  'SFI-MMTST2': { sku: 'SFI-MMTST2', width: 451, height: 227 },
  'SFI-MMTXLEXTB2': { sku: 'SFI-MMTXLEXTB2', width: 485, height: 360.854 },
  'SFI-MPC2': { sku: 'SFI-MPC2', width: 405.896, height: 327.768 },
  'SFI-MPCB2': { sku: 'SFI-MPCB2', width: 212.829, height: 377.394 },
  'SFI-MPDORG2-01': { sku: 'SFI-MPDORG2-01', width: 468.45, height: 221.346 },
  'SFI-MPDORG2-02': { sku: 'SFI-MPDORG2-02', width: 468.45, height: 102.119 },
  'SFI-MPDTB2': { sku: 'SFI-MPDTB2', width: 414.293, height: 321.948 },
  'SFI-MPLB2': { sku: 'SFI-MPLB2', width: 509.591, height: 358.258 },
  'SFI-MPORC2': { sku: 'SFI-MPORC2', width: 319.103, height: 207.706 },
  'SFI-MPRTC-01': { sku: 'SFI-MPRTC-01', width: 720.426, height: 505.307 },
  'SFI-MPRTC-02': { sku: 'SFI-MPRTC-02', width: 809, height: 506.226 },
  'SFI-MPSB2': { sku: 'SFI-MPSB2', width: 496.772, height: 332.348 },
  'SFI-MPTBA2': { sku: 'SFI-MPTBA2', width: 504.734, height: 345.147 },
  'SFI-MPTC2': { sku: 'SFI-MPTC2', width: 490.16, height: 387.149 },
  'SFI-MPTCWB3-01': { sku: 'SFI-MPTCWB3-01', width: 490.16, height: 291.7 },
  'SFI-MPTCWB3-02': { sku: 'SFI-MPTCWB3-02', width: 490.16 , height: 387.149 },
  'SFI-MPXLTB2': { sku: 'SFI-MPXLTB2', width: 501.127, height: 335.529 },
  'SFI-NK940': { sku: 'SFI-NK940', width: 504.85, height: 352.92 },
  'SFI-NUPLARG-01': { sku: 'SFI-NUPLARG-01', width: 312.128, height: 1007},
  'SFI-NUPLARG-02': { sku: 'SFI-NUPLARG-02', width: 327.4, height: 1013.4 },
  'SFI-NUPLARGL': { sku: 'SFI-NUPLARGL', width: 330.5, height: 1022.4 },
  'SFI-NUPMED-01': { sku: 'SFI-NUPMED-01', width: 310.47, height: 730 },
  'SFI-NUPMED-02': { sku: 'SFI-NUPMED-02', width: 322.419, height: 741.833 },
  'SFI-NUPMEDL': { sku: 'SFI-NUPMEDL', width: 329.81, height: 749.436 },
  'SFI-NUPXLARG-01': { sku: 'SFI-NUPXLARG-01', width: 304, height: 1299.984 },
  'SFI-NUPXLARG-02': { sku: 'SFI-NUPXLARG-02', width: 325.896, height: 1311.4 },
  'SFI-NUPXLARGL': { sku: 'SFI-NUPXLARGL', width: 329.88, height: 1317.552 },
  'SFI-OXTTC2': { sku: 'SFI-OXTTC2', width: 470, height: 249 },
  'SFI-OXTTO2': { sku: 'SFI-OXTTO2', width: 470, height: 264 },
  'SFI-OXTTTC2': { sku: 'SFI-OXTTTC2', width: 468, height: 262 },
  'SFI-P0340-01': { sku: 'SFI-P0340-01', width: 435.983, height: 435.983 },
  'SFI-P0340-02': { sku: 'SFI-P0340-02', width: 443.853, height: 444.431 },
  'SFI-P0350-01': { sku: 'SFI-P0350-01', width: 483.998 , height: 484 },
  'SFI-P0350-02': { sku: 'SFI-P0350-02', width: 503.999, height: 503.999 },
  'SFI-P0370-01': { sku: 'SFI-P0370-01', width: 579, height: 579 },
  'SFI-P0370-02': { sku: 'SFI-P0370-02', width: 596, height: 596 },
  'SFI-P1050-01': { sku: 'SFI-P1050-01', width: 161.169, height: 92.779 },
  'SFI-P1060-01': { sku: 'SFI-P1060-01', width: 206.211, height: 104.739 },
  'SFI-P1200-01': { sku: 'SFI-P1200-01', width: 238, height: 182 },
  'SFI-P1200-02': { sku: 'SFI-P1200-02', width: 240, height: 183 },
  'SFI-P1400-01': { sku: 'SFI-P1400-01', width: 302, height: 228.5 },
  'SFI-P1400-02': { sku: 'SFI-P1400-02', width: 306, height: 232 },
  'SFI-P1450-01': { sku: 'SFI-P1450-01', width: 372, height: 258 },
  'SFI-P1450-02': { sku: 'SFI-P1450-02', width: 374, height: 260 },
  'SFI-P1450-03': { sku: 'SFI-P1450-03', width: 384.315, height: 262.483 },
  'SFI-P1485-01': { sku: 'SFI-P1485-01', width: 454.498, height: 262.493 },
  'SFI-P1485-02': { sku: 'SFI-P1485-02', width: 455.998, height: 264.993 },
  'SFI-P1500-01': { sku: 'SFI-P1500-01', width: 428.562, height: 286.176 },
  'SFI-P1500-02': { sku: 'SFI-P1500-02', width: 434, height: 291.6 },
  'SFI-P1507-01': { sku: 'SFI-P1507-01', width: 386, height: 289.999 },
  'SFI-P1507-02': { sku: 'SFI-P1507-02', width: 389.4, height: 296.234 },
  'SFI-P1507-03': { sku: 'SFI-P1507-03', width: 389.401 , height: 296.234 },
  'SFI-P1510FP2-01': { sku: 'SFI-P1510FP2-01', width: 509, height: 282.538 },
  'SFI-P1510FP2-02': { sku: 'SFI-P1510FP2-02', width: 513, height: 287 },
  'SFI-P1520-01': { sku: 'SFI-P1520-01', width: 456, height: 321 },
  'SFI-P1520-02': { sku: 'SFI-P1520-02', width: 460, height: 328.3 },
  'SFI-P1525-01': { sku: 'SFI-P1525-01', width: 524.9, height: 290.992 },
  'SFI-P1525-02': { sku: 'SFI-P1525-02', width: 529, height: 295.992 },
  'SFI-P1535-01': { sku: 'SFI-P1535-01', width: 524, height: 288.5 },
  'SFI-P1535-02': { sku: 'SFI-P1535-02', width: 526, height: 293 },
  'SFI-P1550-01': { sku: 'SFI-P1550-01', width: 474.175, height: 361.362 },
  'SFI-P1550-02': { sku: 'SFI-P1550-02', width: 475.203, height: 363.459 },
  'SFI-P1555-01': { sku: 'SFI-P1555-01', width: 588, height: 328 },
  'SFI-P1555-02': { sku: 'SFI-P1555-02', width: 592, height: 334 },
  'SFI-P1556-01': { sku: 'SFI-P1556-01', width: 550.997 , height: 274.497 },
  'SFI-P1556-02': { sku: 'SFI-P1556-02', width: 550.998, height: 274.497 },
  'SFI-P1556-03': { sku: 'SFI-P1556-03', width: 556, height: 283 },
  'SFI-P1560-01': { sku: 'SFI-P1560-01', width: 507, height: 381.567 },
  'SFI-P1560-02': { sku: 'SFI-P1560-02', width: 516, height: 389.774 },
  'SFI-P1595-01': { sku: 'SFI-P1595-01', width: 653.999, height: 382.499 },
  'SFI-P1595-02': { sku: 'SFI-P1595-02', width: 657.499, height: 389.5 },
  'SFI-P1595-03': { sku: 'SFI-P1595-03', width: 659.499, height: 391.499 },
  'SFI-P1600-01': { sku: 'SFI-P1600-01', width: 556, height: 421 },
  'SFI-P1600-02': { sku: 'SFI-P1600-02', width: 554, height: 427 },
  'SFI-P1605-01': { sku: 'SFI-P1605-01', width: 664.5, height: 359 },
  'SFI-P1605-02': { sku: 'SFI-P1605-02', width: 668, height: 368 },
  'SFI-P1607-01': { sku: 'SFI-P1607-01', width: 534.072, height: 401.9 },
  'SFI-P1607-02': { sku: 'SFI-P1607-02', width: 536.66, height: 401.376 },
  'SFI-P1607-03': { sku: 'SFI-P1607-03', width: 547.164, height: 412.685 },
  'SFI-P1607-04': { sku: 'SFI-P1607-04', width: 549.67 , height: 414.477 },
  'SFI-P1610-01': { sku: 'SFI-P1610-01', width: 551, height: 424.734 },
  'SFI-P1610-02': { sku: 'SFI-P1610-02', width: 557, height: 433 },
  'SFI-P1610-03': { sku: 'SFI-P1610-03', width: 566, height: 436 },
  'SFI-P1620-01': { sku: 'SFI-P1620-01', width: 547.016, height: 431.669 },
  'SFI-P1620-02': { sku: 'SFI-P1620-02', width: 557.33, height: 428.626 },
  'SFI-P1620-03': { sku: 'SFI-P1620-03', width: 544.469, height: 417.018 },
  'SFI-P1620-04': { sku: 'SFI-P1620-04', width: 561.598, height: 431.3 },
  'SFI-P1620-05': { sku: 'SFI-P1620-05', width: 562, height: 434 },
  'SFI-P1640-01': { sku: 'SFI-P1640-01', width: 615, height: 615 },
  'SFI-P1640-02': { sku: 'SFI-P1640-02', width: 629, height: 629 },
  'SFI-P1640-03': { sku: 'SFI-P1640-03', width: 626.622, height: 626.622 },
  'SFI-P1640-04': { sku: 'SFI-P1640-04', width: 629, height: 629 },
  'SFI-P1700G1-01': { sku: 'SFI-P1700G1-01', width: 908.654, height: 348.645 },
  'SFI-P1700G1-02': { sku: 'SFI-P1700G1-02', width: 912.128, height: 352.382 },
  'SFI-P1700G1-03': { sku: 'SFI-P1700G1-03', width: 914, height: 352.631 },
  'SFI-P1700G2-01': { sku: 'SFI-P1700G2-01', width: 908.654, height: 348.645 },
  'SFI-P1700G2-02': { sku: 'SFI-P1700G2-02', width: 912.665, height: 352 },
  'SFI-P1700G2-03': { sku: 'SFI-P1700G2-03', width: 912.871, height: 352 },
  'SFI-P1720G1-01': { sku: 'SFI-P1720G1-01', width: 339.953, height: 1062.157 },
  'SFI-P1720G1-02': { sku: 'SFI-P1720G1-02', width: 345.072, height: 1067.275 },
  'SFI-P1720G1-03': { sku: 'SFI-P1720G1-03', width: 342.943, height: 1065.063 },
  'SFI-P11201': { sku: 'SFI-P11201', width: 187, height: 123 },
  'SFI-P11202': { sku: 'SFI-P11202', width: 187, height: 123 },
  'SFI-P11501': { sku: 'SFI-P11501', width: 212, height: 148.5 },
  'SFI-P11502-02': { sku: 'SFI-P11502-02', width: 215.45, height: 151.96 },
  'SFI-PAR2975-01': { sku: 'SFI-PAR2975-01', width: 506, height: 275 },
  'SFI-PAR2975-02': { sku: 'SFI-PAR2975-02', width: 509, height: 280 },
  'SFI-PAR2975-03': { sku: 'SFI-PAR2975-03', width: 513, height: 284 },
  'SFI-PAR2975-04': { sku: 'SFI-PAR2975-04', width: 514, height: 285 },
  'SFI-PAR3463-01': { sku: 'SFI-PAR3463-01', width: 470, height: 360 },
  'SFI-PAR3463-02': { sku: 'SFI-PAR3463-02', width: 469.744 , height: 359.961 },
  'SFI-PAR3463-03': { sku: 'SFI-PAR3463-03', width: 475, height: 367 },
  'SFI-PAR3463-04': { sku: 'SFI-PAR3463-04', width: 475, height: 370.175 },
  'SFI-PAR5032-01': { sku: 'SFI-PAR5032-01', width: 900, height: 323 },
  'SFI-PAR5032-02': { sku: 'SFI-PAR5032-02', width: 932, height: 350 },
  'SFI-PAR5032-03': { sku: 'SFI-PAR5032-03', width: 924, height: 348 },
  'SFI-PAR5584-01': { sku: 'SFI-PAR5584-01', width: 300, height: 1285 },
  'SFI-PAR5584-02': { sku: 'SFI-PAR5584-02', width: 316, height: 1311 },
  'SFI-PAR5584-03': { sku: 'SFI-PAR5584-03', width: 305, height: 1300 },
  'SFI-PAR8428-01': { sku: 'SFI-PAR8428-01', width: 568, height: 435 },
  'SFI-PAR8428-02': { sku: 'SFI-PAR8428-02', width: 587, height: 445 },
  'SFI-PAR8428-03': { sku: 'SFI-PAR8428-03', width: 578, height: 439 },
  'SFI-PIM2500-01': { sku: 'SFI-PIM2500-01', width: 513, height: 284 },
  'SFI-PIM2500-02': { sku: 'SFI-PIM2500-02', width: 517, height: 289 },
  'SFI-PIM2500-03': { sku: 'SFI-PIM2500-03', width: 518, height: 289 },
  'SFI-PiM2600-01': { sku: 'SFI-PiM2600-01', width: 502, height: 348 },
  'SFI-PiM2600-02': { sku: 'SFI-PiM2600-02', width: 507, height: 354.567 },
  'SFI-QB2D2': { sku: 'SFI-QB2D2', width: 470, height: 298 },
  'SFI-QBONE2002': { sku: 'SFI-QBONE2002', width: 518, height: 325 },
  'SFI-QBONE3502': { sku: 'SFI-QBONE3502', width: 510, height: 325 },
  'SFI-QBONEORG2': { sku: 'SFI-QBONEORG2', width: 505, height: 310 },
  'SFI-QBPC2': { sku: 'SFI-QBPC2', width: 365, height: 219 },
  'SFI-QBPD3TB2': { sku: 'SFI-QBPD3TB2', width: 472, height: 296 },
  'SFI-QBPD3TB3': { sku: 'SFI-QBPD3TB3', width: 472, height: 296 },
  'SFI-QBPROD1TB2': { sku: 'SFI-QBPROD1TB2', width: 330, height: 225 },
  'SFI-QBPROD2TB2': { sku: 'SFI-QBPROD2TB2', width: 339, height: 244 },
  'SFI-QBSP6002': { sku: 'SFI-QBSP6002', width: 500, height: 218 },
  'SFI-QBSPC2D22': { sku: 'SFI-QBSPC2D22', width: 470, height: 298 },
  'SFI-QBSPT2': { sku: 'SFI-QBSPT2', width: 410, height: 268 },
  'SFI-QBTC22': { sku: 'SFI-QBTC22', width: 375, height: 258 },
  'SFI-RBRCL2': { sku: 'SFI-RBRCL2', width: 573, height: 365 },
  'SFI-RBRCM2': { sku: 'SFI-RBRCM2', width: 377.368, height: 373.012 },
  'SFI-RBRCS2': { sku: 'SFI-RBRCS2', width: 376.255, height: 168 },
  'SFI-RCM2': { sku: 'SFI-RCM2', width: 399, height: 300 },
  'SFI-RIGPG3DB2': { sku: 'SFI-RIGPG3DB2', width: 403, height: 313 },
  'SFI-RIGPG3DT2': { sku: 'SFI-RIGPG3DT2', width: 405, height: 314 },
  'SFI-RLCSPO2': { sku: 'SFI-RLCSPO2', width: 371.061, height: 236.516 },
  'SFI-RLD2': { sku: 'SFI-RLD2', width: 385, height: 331 },
  'SFI-RLMTB2': { sku: 'SFI-RLMTB2', width: 527.897, height: 372.925 },
  'SFI-RLSPO2': { sku: 'SFI-RLSPO2', width: 474.5, height: 371.5 },
  'SFI-RLSTB2': { sku: 'SFI-RLSTB2', width: 528.557, height: 377.334 },
  'SFI-RLTC2': { sku: 'SFI-RLTC2', width: 530.16, height: 371.234 },
  'SFI-RLTSC2-01': { sku: 'SFI-RLTSC2-01', width: 481, height: 310 },
  'SFI-RLTSC2-02': { sku: 'SFI-RLTSC2-02', width: 535.899, height: 342.412 },
  'SFI-RTBL1DC2': { sku: 'SFI-RTBL1DC2', width: 519, height: 335 },
  'SFI-RTBL4DC2': { sku: 'SFI-RTBL4DC2', width: 230, height: 335 },
  'SFI-RTC2': { sku: 'SFI-RTC2', width: 512.375, height: 349.547 },
  'SFI-RTCB2': { sku: 'SFI-RTCB2', width: 517.561, height: 300.855 },
  'SFI-RTO2': { sku: 'SFI-RTO2', width: 519.415, height: 292.272 },
  'SFI-SPT22': { sku: 'SFI-SPT22', width: 370, height: 250 },
  'SFI-TBST3D2': { sku: 'SFI-TBST3D2', width: 380, height: 326 },
  'SFI-TBSTCO2': { sku: 'SFI-TBSTCO2', width: 310.019, height: 202.091 },
  'SFI-TBSTCTB2-01': { sku: 'SFI-TBSTCTB2-01', width: 315.181, height: 205 },
  'SFI-TBSTCTB2-02': { sku: 'SFI-TBSTCTB2-02', width: 338, height: 221 },
  'SFI-TBSTLTB2-01': { sku: 'SFI-TBSTLTB2-01', width: 466.778 , height: 320.223 },
  'SFI-TBSTLTB2-02': { sku: 'SFI-TBSTLTB2-02', width: 468, height: 365.924 },
  'SFI-TBSTO2-01': { sku: 'SFI-TBSTO2-01', width: 470, height: 313.474 },
  'SFI-TBSTO2-02': { sku: 'SFI-TBSTO2-02', width: 470, height: 370 },
  'SFI-TBSTRTB2-01': { sku: 'SFI-TBSTRTB2-01', width: 465.034, height: 333.276 },
  'SFI-TBSTRTB2-02': { sku: 'SFI-TBSTRTB2-02', width: 467.034, height: 355.276 },
  'SFI-TBSTTB2-01': { sku: 'SFI-TBSTTB2-01', width: 469, height: 321.723 },
  'SFI-TBSTTB2-02': { sku: 'SFI-TBSTTB2-02', width: 473, height: 352.676 },
  'SFI-TBSTTC2-01': { sku: 'SFI-TBSTTC2-01', width: 468.6, height: 311 },
  'SFI-TBSTTC2-02': { sku: 'SFI-TBSTTC2-02', width: 466, height: 343 },
  'SFI-TT1002': { sku: 'SFI-TT1002', width: 485.15, height: 256.337 },
  'SFI-TT2002': { sku: 'SFI-TT2002', width: 487.86 , height: 256.998 },
  'SFI-VDSC3': { sku: 'SFI-VDSC3', width: 370, height: 255 },
  'SFI-VSSC2': { sku: 'SFI-VSSC2', width: 435, height: 297.939 },
  'SFI-WSTBBX2': { sku: 'SFI-WSTBBX2', width: 449, height: 333 },
  'SFI-WTHSC4412': { sku: 'SFI-WTHSC4412', width: 334, height: 230 },
  'SFI-WTHSC8432': { sku: 'SFI-WTHSC8432', width: 463.5, height: 335 },
};

// Unit conversion factors to mm
const UNIT_TO_MM = {
  'mm': 1,
  'cm': 10,
  'in': 25.4,
  'pt': 0.352778, // 1/72 inch
  'pc': 4.233333, // 1/6 inch
  'px': 0.264583, // assumes 96 DPI
  '': 0.264583, // default to px conversion
};

/**
 * Parse SVG width/height attributes to extract numeric value and unit
 */
export function parseSvgDimension(dimensionStr: string): { value: number; unit: string } {
  if (!dimensionStr) return { value: 0, unit: 'px' };
  
  const match = dimensionStr.trim().match(/^([\d.]+)([a-z%]*)$/i);
  if (!match) return { value: 0, unit: 'px' };
  
  return {
    value: parseFloat(match[1]),
    unit: match[2] || 'px'
  };
}

/**
 * Convert dimension value to millimeters
 */
export function convertToMm(value: number, unit: string): number {
  const normalizedUnit = unit.toLowerCase() as keyof typeof UNIT_TO_MM;
  const factor = UNIT_TO_MM[normalizedUnit] || UNIT_TO_MM.px;
  return value * factor;
}

/**
 * Extract actual dimensions from SVG content or DOM element
 */
export function extractSvgDimensions(svgContent: string): SvgDimensions {
  try {
    const parser = new DOMParser();
    const svgDoc = parser.parseFromString(svgContent, 'image/svg+xml');
    const svgElement = svgDoc.documentElement;
    
    if (svgElement.nodeName.toLowerCase() !== 'svg') {
      throw new Error('Invalid SVG content');
    }
    
    // Get width and height attributes
    const widthAttr = svgElement.getAttribute('width') || '';
    const heightAttr = svgElement.getAttribute('height') || '';
    
    const width = parseSvgDimension(widthAttr);
    const height = parseSvgDimension(heightAttr);
    
    // If no width/height attributes, try to extract from viewBox
    if (!width.value || !height.value) {
      const viewBox = svgElement.getAttribute('viewBox');
      if (viewBox) {
        const parts = viewBox.trim().split(/\s+/);
        if (parts.length === 4) {
          const vbWidth = parseFloat(parts[2]);
          const vbHeight = parseFloat(parts[3]);
          
          return {
            width: vbWidth,
            height: vbHeight,
            unit: 'viewBox'
          };
        }
      }
    }
    
    return {
      width: width.value,
      height: height.value,
      unit: width.unit || height.unit || 'px'
    };
  } catch (error) {
    console.error('Error extracting SVG dimensions:', error);
    return { width: 0, height: 0, unit: 'px' };
  }
}

/**
 * Calculate the bounding box of the main path in an SVG
 */
export function calculatePathBounds(svgContent: string): { width: number; height: number } | null {
  try {
    const parser = new DOMParser();
    const svgDoc = parser.parseFromString(svgContent, 'image/svg+xml');
    
    // Find all path elements
    const paths = svgDoc.getElementsByTagName('path');
    if (paths.length === 0) return null;
    
    // Find the path with the most complex geometry (likely the main outline)
    let mainPath = paths[0];
    let maxComplexity = 0;
    
    for (let i = 0; i < paths.length; i++) {
      const pathData = paths[i].getAttribute('d') || '';
      const complexity = pathData.length; // Simple complexity measure
      if (complexity > maxComplexity) {
        maxComplexity = complexity;
        mainPath = paths[i];
      }
    }
    
    // Parse path data to extract coordinates
    const pathData = mainPath.getAttribute('d') || '';
    const coords = extractPathCoordinates(pathData);
    
    if (coords.length === 0) return null;
    
    // Calculate bounding box
    const xCoords = coords.filter((_, i) => i % 2 === 0);
    const yCoords = coords.filter((_, i) => i % 2 === 1);
    
    const minX = Math.min(...xCoords);
    const maxX = Math.max(...xCoords);
    const minY = Math.min(...yCoords);
    const maxY = Math.max(...yCoords);
    
    return {
      width: maxX - minX,
      height: maxY - minY
    };
  } catch (error) {
    console.error('Error calculating path bounds:', error);
    return null;
  }
}

/**
 * Extract coordinate values from SVG path data
 */
function extractPathCoordinates(pathData: string): number[] {
  const coords: number[] = [];
  
  // Match all numeric values in the path data
  const matches = pathData.match(/[-+]?[0-9]*\.?[0-9]+([eE][-+]?[0-9]+)?/g);
  
  if (matches) {
    for (const match of matches) {
      const num = parseFloat(match);
      if (!isNaN(num)) {
        coords.push(num);
      }
    }
  }
  
  return coords;
}

/**
 * Validate SVG dimensions against expected dimensions for a given SKU
 */
export function validateSvgDimensions(sku: string, svgContent: string): ValidationResult {
  const expected = EXPECTED_DIMENSIONS[sku];
  if (!expected) {
    throw new Error(`No expected dimensions found for SKU: ${sku}`);
  }
  
  // Extract actual dimensions from SVG
  const actualSvgDims = extractSvgDimensions(svgContent);
  
  // Convert to mm for comparison
  const actualWidthMm = convertToMm(actualSvgDims.width, actualSvgDims.unit);
  const actualHeightMm = convertToMm(actualSvgDims.height, actualSvgDims.unit);
  
  // Try path bounds if SVG dimensions are unreliable
  let pathBounds = null;
  if (actualSvgDims.unit === 'viewBox' || actualWidthMm === 0 || actualHeightMm === 0) {
    pathBounds = calculatePathBounds(svgContent);
  }
  
  const finalActualDims: SvgDimensions = pathBounds ? {
    width: pathBounds.width,
    height: pathBounds.height,
    unit: 'path-units'
  } : actualSvgDims;
  
  const finalWidthMm = pathBounds ? pathBounds.width : actualWidthMm;
  const finalHeightMm = pathBounds ? pathBounds.height : actualHeightMm;
  
  // Calculate differences
  const widthDiff = Math.abs(finalWidthMm - expected.width);
  const heightDiff = Math.abs(finalHeightMm - expected.height);
  const widthDiffPercent = (widthDiff / expected.width) * 100;
  const heightDiffPercent = (heightDiff / expected.height) * 100;
  
  // Determine if dimensions are valid (within 5% tolerance)
  const TOLERANCE_PERCENT = 5;
  const isValid = widthDiffPercent <= TOLERANCE_PERCENT && heightDiffPercent <= TOLERANCE_PERCENT;
  
  // Generate recommendations
  const recommendations: string[] = [];
  
  if (!isValid) {
    if (widthDiffPercent > TOLERANCE_PERCENT) {
      const scaleFactor = expected.width / finalWidthMm;
      recommendations.push(`Width is off by ${widthDiffPercent.toFixed(1)}%. Consider scaling width by factor of ${scaleFactor.toFixed(3)}.`);
    }
    
    if (heightDiffPercent > TOLERANCE_PERCENT) {
      const scaleFactor = expected.height / finalHeightMm;
      recommendations.push(`Height is off by ${heightDiffPercent.toFixed(1)}%. Consider scaling height by factor of ${scaleFactor.toFixed(3)}.`);
    }
    
    if (actualSvgDims.unit === 'viewBox' || actualSvgDims.unit === 'path-units') {
      recommendations.push('SVG uses viewBox or path coordinates. Consider adding explicit width/height attributes with units.');
    }
    
    if (actualSvgDims.unit !== 'mm') {
      recommendations.push(`SVG uses ${actualSvgDims.unit} units. Consider converting to millimeters for precision.`);
    }
  }
  
  return {
    isValid,
    actualDimensions: finalActualDims,
    expectedDimensions: expected,
    dimensionDifference: {
      widthDiff,
      heightDiff,
      widthDiffPercent,
      heightDiffPercent
    },
    recommendations
  };
}

/**
 * Generate a corrected SVG with proper dimensions
 */
export function generateCorrectedSvg(sku: string, originalSvgContent: string): string {
  const validation = validateSvgDimensions(sku, originalSvgContent);
  
  if (validation.isValid) {
    return originalSvgContent; // No correction needed
  }
  
  const expected = validation.expectedDimensions;
  const actual = validation.actualDimensions;
  
  try {
    const parser = new DOMParser();
    const svgDoc = parser.parseFromString(originalSvgContent, 'image/svg+xml');
    const svgElement = svgDoc.documentElement;
    
    // Set correct dimensions in mm
    svgElement.setAttribute('width', `${expected.width}mm`);
    svgElement.setAttribute('height', `${expected.height}mm`);
    
    // Update viewBox to maintain aspect ratio
    const currentViewBox = svgElement.getAttribute('viewBox');
    if (currentViewBox) {
      const parts = currentViewBox.trim().split(/\s+/);
      if (parts.length === 4) {
        // Keep the same origin and scale proportionally
        const scaleX = expected.width / (actual.width || 1);
        const scaleY = expected.height / (actual.height || 1);
        
        // Use uniform scaling to maintain proportions
        const scale = Math.min(scaleX, scaleY);
        const newWidth = parseFloat(parts[2]) * scale;
        const newHeight = parseFloat(parts[3]) * scale;
        
        svgElement.setAttribute('viewBox', `${parts[0]} ${parts[1]} ${newWidth} ${newHeight}`);
      }
    } else {
      // Create a viewBox based on expected dimensions
      svgElement.setAttribute('viewBox', `0 0 ${expected.width} ${expected.height}`);
    }
    
    // Serialize the corrected SVG
    const serializer = new XMLSerializer();
    return serializer.serializeToString(svgDoc);
  } catch (error) {
    console.error('Error generating corrected SVG:', error);
    return originalSvgContent; // Return original if correction fails
  }
}

/**
 * Batch validate multiple SVG files
 */
export function batchValidateSvgs(svgFiles: { sku: string; content: string }[]): ValidationResult[] {
  return svgFiles.map(file => {
    try {
      return validateSvgDimensions(file.sku, file.content);
    } catch (error) {
      console.error(`Error validating SVG for SKU ${file.sku}:`, error);
      return {
        isValid: false,
        actualDimensions: { width: 0, height: 0, unit: 'unknown' },
        expectedDimensions: { sku: file.sku, width: 0, height: 0 },
        dimensionDifference: { widthDiff: 0, heightDiff: 0, widthDiffPercent: 100, heightDiffPercent: 100 },
        recommendations: ['Error occurred during validation']
      };
    }
  });
}

/**
 * Generate a validation report
 */
export function generateValidationReport(results: ValidationResult[]): string {
  const report: string[] = [];
  report.push('SVG Dimension Validation Report');
  report.push('='.repeat(40));
  report.push('');
  
  const validCount = results.filter(r => r.isValid).length;
  const totalCount = results.length;
  
  report.push(`Overall Status: ${validCount}/${totalCount} SVGs passed validation`);
  report.push('');
  
  results.forEach((result, index) => {
    const status = result.isValid ? '✅ PASS' : '❌ FAIL';
    report.push(`${index + 1}. ${result.expectedDimensions.sku} - ${status}`);
    report.push(`   Expected: ${result.expectedDimensions.width}mm × ${result.expectedDimensions.height}mm`);
    report.push(`   Actual: ${result.actualDimensions.width.toFixed(2)}${result.actualDimensions.unit} × ${result.actualDimensions.height.toFixed(2)}${result.actualDimensions.unit}`);
    
    if (!result.isValid) {
      report.push(`   Width difference: ${result.dimensionDifference.widthDiffPercent.toFixed(1)}%`);
      report.push(`   Height difference: ${result.dimensionDifference.heightDiffPercent.toFixed(1)}%`);
      
      if (result.recommendations.length > 0) {
        report.push('   Recommendations:');
        result.recommendations.forEach(rec => {
          report.push(`     • ${rec}`);
        });
      }
    }
    report.push('');
  });
  
  return report.join('\n');
} 