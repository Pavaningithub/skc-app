import re

# Fix services.ts - replace escaped backticks with real backticks
with open('src/lib/services.ts', 'r', encoding='utf-8') as f:
    content = f.read()

content = content.replace('\\`', '`')

with open('src/lib/services.ts', 'w', encoding='utf-8') as f:
    f.write(content)

print("Fixed services.ts")

# Check types.ts for same issue
with open('src/lib/types.ts', 'r', encoding='utf-8') as f:
    content2 = f.read()

content2 = content2.replace('\\`', '`')

with open('src/lib/types.ts', 'w', encoding='utf-8') as f:
    f.write(content2)

print("Fixed types.ts")
