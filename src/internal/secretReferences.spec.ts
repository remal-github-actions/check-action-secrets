import { findSecretReferences } from './secretReferences.js'

function names(content: string): string[] {
    return findSecretReferences(content).map(it => it.name)
}

describe('findSecretReferences', () => {

    it('finds a bare secret reference', () => {
        expect(names('${{ secrets.FOO }}')).toEqual(['FOO'])
    })

    it('finds a secret reference with no surrounding spaces', () => {
        expect(names('${{secrets.FOO}}')).toEqual(['FOO'])
    })

    it('finds a negated secret reference', () => {
        expect(names('${{ !secrets.FOO }}')).toEqual(['FOO'])
    })

    it('finds a double-negated secret reference', () => {
        expect(names('${{ !!secrets.FOO }}')).toEqual(['FOO'])
    })

    it('finds a parenthesized secret reference', () => {
        expect(names('${{ (secrets.FOO) }}')).toEqual(['FOO'])
    })

    it('finds a secret reference after &&', () => {
        expect(names('${{ github.event.foo && secrets.BAR }}')).toEqual(['BAR'])
    })

    it('finds a secret reference after ||', () => {
        expect(names('${{ true || secrets.BAR }}')).toEqual(['BAR'])
    })

    it('finds multiple secret references in one expression', () => {
        expect(names('${{ secrets.FOO && secrets.BAR }}')).toEqual(['FOO', 'BAR'])
    })

    it('finds multiple secret references with no spaces around operators', () => {
        expect(names('${{ secrets.FOO&&secrets.BAR }}')).toEqual(['FOO', 'BAR'])
    })

    it('finds a secret name containing underscores and digits', () => {
        expect(names('${{ secrets.MY_SECRET_1 }}')).toEqual(['MY_SECRET_1'])
    })

    it('finds a secret reference wrapped in a function call', () => {
        expect(names("${{ fromJSON(secrets.FOO).bar }}")).toEqual(['FOO'])
    })

    it('does not treat a step id ending in "-secrets" as a secret reference', () => {
        // regression test for CI run https://github.com/remal-gradle-plugins/merge-resources/actions/runs/30020045731,
        // where a step id "retrieve-secrets" made `\b` match "secrets" inside it, misreading
        // "steps.retrieve-secrets.outputs.signing-key" as an unknown secret named "outputs"
        expect(names('${{ steps.retrieve-secrets.outputs.signing-key }}')).toEqual([])
    })

    it('does not treat any hyphenated identifier ending in "-secrets" as a secret reference', () => {
        expect(names('${{ my-secrets.BAZ }}')).toEqual([])
        expect(names('${{ job-secrets.outputs.value }}')).toEqual([])
        expect(names('${{ vars.build-secrets.name }}')).toEqual([])
    })

    it('does not treat "secrets" chained after another context as a secret reference', () => {
        expect(names('${{ outputs.secrets.FOO }}')).toEqual([])
        expect(names('${{ steps.foo.secrets.bar }}')).toEqual([])
    })

    it('correctly isolates real secret references from hyphenated false shapes in a composite expression', () => {
        const content = "${{ fromJSON(steps.retrieve-secrets.outputs.result).value == 'x'"
            + " && secrets.API_KEY || !secrets.OPTIONAL_KEY && vars.build-secrets.name }}"
        expect(names(content)).toEqual(['API_KEY', 'OPTIONAL_KEY'])
    })

    it('finds no references outside of ${{ }} substitutions', () => {
        expect(names('secrets.FOO')).toEqual([])
    })

    it('finds no references in content with no substitutions', () => {
        expect(names('plain text, no expressions here')).toEqual([])
    })

})
