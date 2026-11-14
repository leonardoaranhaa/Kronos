function zeros(size: number): number[][] {
  return Array.from({ length: size }, () => new Array<number>(size).fill(0));
}

function dot(left: readonly number[], right: readonly number[]): number {
  let sum = 0;
  for (let index = 0; index < left.length; index++) sum += left[index] * right[index];
  return sum;
}

/** Gaussian elimination with partial pivoting. Returns null when the system is singular. */
export function solveLinear(matrix: readonly (readonly number[])[], rhs: readonly number[]): number[] | null {
  const size = rhs.length;
  if (matrix.length !== size || matrix.some(row => row.length !== size)) return null;
  const augmented = matrix.map((row, index) => [...row, rhs[index]]);
  for (let column = 0; column < size; column++) {
    let pivot = column;
    for (let row = column + 1; row < size; row++) {
      if (Math.abs(augmented[row][column]) > Math.abs(augmented[pivot][column])) pivot = row;
    }
    if (!(Math.abs(augmented[pivot][column]) > 1e-12)) return null;
    if (pivot !== column) {
      const swap = augmented[column];
      augmented[column] = augmented[pivot];
      augmented[pivot] = swap;
    }
    const scale = augmented[column][column];
    for (let columnIndex = column; columnIndex <= size; columnIndex++) augmented[column][columnIndex] /= scale;
    for (let row = 0; row < size; row++) {
      if (row === column) continue;
      const factor = augmented[row][column];
      if (factor === 0) continue;
      for (let columnIndex = column; columnIndex <= size; columnIndex++) {
        augmented[row][columnIndex] -= factor * augmented[column][columnIndex];
      }
    }
  }
  return augmented.map(row => row[size]);
}

export function sigmoid(value: number): number {
  if (value > 30) return 1;
  if (value < -30) return 0;
  return 1 / (1 + Math.exp(-value));
}

function clipProbability(value: number): number {
  if (value < 1e-4) return 1e-4;
  if (value > 1 - 1e-4) return 1 - 1e-4;
  return value;
}

export interface Standardization {
  mean: number[];
  std: number[];
}

export function standardizeFit(rows: readonly (readonly number[])[]): Standardization | null {
  if (rows.length < 2) return null;
  const width = rows[0].length;
  const mean = new Array<number>(width).fill(0);
  for (const row of rows) {
    for (let column = 0; column < width; column++) mean[column] += row[column];
  }
  for (let column = 0; column < width; column++) mean[column] /= rows.length;
  const std = new Array<number>(width).fill(0);
  for (const row of rows) {
    for (let column = 0; column < width; column++) std[column] += (row[column] - mean[column]) ** 2;
  }
  for (let column = 0; column < width; column++) std[column] = Math.sqrt(std[column] / (rows.length - 1));
  return { mean, std };
}

export function applyStandard(row: readonly number[], scale: Standardization): number[] {
  const design = [1];
  for (let column = 0; column < row.length; column++) {
    design.push(scale.std[column] > 1e-12 ? (row[column] - scale.mean[column]) / scale.std[column] : 0);
  }
  return design;
}

/**
 * L2-regularized logistic regression. The intercept is column 0 and is not penalized.
 * Rows already include the intercept. Labels are 0 or 1.
 */
export function fitLogistic(
  rows: readonly (readonly number[])[],
  labels: readonly number[],
  lambda: number,
  iterations: number
): number[] | null {
  if (rows.length !== labels.length || rows.length === 0) return null;
  const positives = labels.filter(label => label === 1).length;
  if (positives < 1 || positives === labels.length) return null;
  const width = rows[0].length;
  let beta = new Array<number>(width).fill(0);
  for (let iteration = 0; iteration < iterations; iteration++) {
    const gram = zeros(width);
    const target = new Array<number>(width).fill(0);
    for (let rowIndex = 0; rowIndex < rows.length; rowIndex++) {
      const probability = clipProbability(sigmoid(dot(beta, rows[rowIndex])));
      const weight = probability * (1 - probability);
      const working = dot(beta, rows[rowIndex]) + (labels[rowIndex] - probability) / weight;
      for (let left = 0; left < width; left++) {
        target[left] += rows[rowIndex][left] * weight * working;
        for (let right = 0; right < width; right++) {
          gram[left][right] += rows[rowIndex][left] * weight * rows[rowIndex][right];
        }
      }
    }
    for (let column = 1; column < width; column++) gram[column][column] += lambda;
    const next = solveLinear(gram, target);
    if (!next || next.some(value => !Number.isFinite(value))) return beta.some(value => value !== 0) ? beta : null;
    beta = next;
  }
  return beta;
}

/** Ridge regression. The intercept is column 0 and is not penalized. */
export function fitRidge(
  rows: readonly (readonly number[])[],
  targets: readonly number[],
  lambda: number
): number[] | null {
  if (rows.length !== targets.length || rows.length === 0) return null;
  const width = rows[0].length;
  const gram = zeros(width);
  const target = new Array<number>(width).fill(0);
  for (let rowIndex = 0; rowIndex < rows.length; rowIndex++) {
    for (let left = 0; left < width; left++) {
      target[left] += rows[rowIndex][left] * targets[rowIndex];
      for (let right = 0; right < width; right++) {
        gram[left][right] += rows[rowIndex][left] * rows[rowIndex][right];
      }
    }
  }
  for (let column = 1; column < width; column++) gram[column][column] += lambda;
  const beta = solveLinear(gram, target);
  if (!beta || beta.some(value => !Number.isFinite(value))) return null;
  return beta;
}

export interface FoldModel {
  scale: Standardization;
  direction: number[];
  magnitude: number[];
}

export function fitFoldModel(
  features: readonly (readonly number[])[],
  up: readonly number[],
  forwardReturn: readonly number[],
  lambdaLogistic: number,
  lambdaRidge: number,
  iterations: number
): FoldModel | null {
  const scale = standardizeFit(features);
  if (!scale) return null;
  const design = features.map(row => applyStandard(row, scale));
  const direction = fitLogistic(design, up, lambdaLogistic, iterations);
  const magnitude = fitRidge(design, forwardReturn, lambdaRidge);
  if (!direction || !magnitude) return null;
  return { scale, direction, magnitude };
}

export function predictFold(model: FoldModel, features: readonly number[]): { probabilityUp: number; expectedReturn: number } {
  const design = applyStandard(features, model.scale);
  return {
    probabilityUp: sigmoid(dot(model.direction, design)),
    expectedReturn: dot(model.magnitude, design)
  };
}
