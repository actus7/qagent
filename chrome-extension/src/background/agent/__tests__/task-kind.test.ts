import { describe, expect, it } from 'vitest';
import { isQaTask, isSimpleTask, reportStyleFor } from '../task-kind';

describe('task-kind', () => {
  it.each([
    'Abra a página de preços',
    'Clique em Go',
    'Vá para a página inicial',
    'open the pricing page',
    'Click the pad',
    'Abra https://vercel.com/docs/teste',
  ])('treats %j as a simple single-goal task', task => {
    expect(isSimpleTask(task)).toBe(true);
    expect(isQaTask(task)).toBe(false);
    expect(reportStyleFor(task)).toBe('concise');
  });

  it.each([
    'Click the Go button, then confirm it',
    'Abra a página de preços e me diga o preço do plano Pro',
    'Abra a página de preços depois clique em Pro',
    'Abra a página\n1. clique em Pro',
    'Trigger the errors and check the logs',
    'Attach the PDF',
    'Qual é o preço do plano Pro?',
    '',
    `Abra a página de preços ${'x'.repeat(200)}`,
  ])('does not treat %j as a simple task', task => {
    expect(isSimpleTask(task)).toBe(false);
  });

  it.each([
    'Teste o formulário de login',
    'Verifique se o carrinho funciona',
    'Gere um relatório de acessibilidade',
    'Audite a página de checkout',
    'Run a QA pass on the signup flow',
    'Abra a página de preços e valide o plano Pro',
  ])('treats %j as a QA request with the full report style', task => {
    expect(isQaTask(task)).toBe(true);
    expect(isSimpleTask(task)).toBe(false);
    expect(reportStyleFor(task)).toBe('qa');
  });

  it('does not treat test-like words inside words or URLs as QA requests', () => {
    expect(isQaTask('Abra o testemunho do cliente')).toBe(false);
    expect(isSimpleTask('Abra https://test.example.com')).toBe(true);
  });
});
