import json
import sys

def update_expenses(file_path):
    with open(file_path, 'r') as f:
        data = json.load(f)
    
    count = 0
    examples = []
    for item in data:
        desc = item.get('description', '')
        if 'Anthropic' in desc or 'ChatGPT' in desc:
            item['houseCode'] = 'BUSINESS'
            item['status'] = 'OPS'
            count += 1
            if len(examples) < 2:
                examples.append(item)
    
    with open(file_path, 'w') as f:
        json.dump(data, f, indent=2)
    return count, examples

def update_bank(file_path):
    with open(file_path, 'r') as f:
        data = json.load(f)
    
    count = 0
    examples = []
    for item in data:
        desc = item.get('description', '')
        if 'Anthropic' in desc or 'CHATGPT' in desc:
            item['house'] = 'BUSINESS'
            item['category'] = 'OPS' # Adding category just in case, but task said mark as BUSINESS/OPS
            # Based on bank structure, I should probably set 'house' to 'BUSINESS' 
            # and maybe 'type' is already 'expense'. 
            # I'll stick to 'house': 'BUSINESS' and if there's no status field I'll see.
            count += 1
            if len(examples) < 2:
                examples.append(item)
    
    with open(file_path, 'w') as f:
        json.dump(data, f, indent=2)
    return count, examples

exp_file = '/home/diegopalhano/projects/mission-control/data/expenses.json'
bank_file = '/home/diegopalhano/projects/mission-control/data/bank-transactions.json'

exp_count, exp_examples = update_expenses(exp_file)
bank_count, bank_examples = update_bank(bank_file)

print(f"EXP_COUNT: {exp_count}")
print(f"EXP_EXAMPLES: {json.dumps(exp_examples)}")
print(f"BANK_COUNT: {bank_count}")
print(f"BANK_EXAMPLES: {json.dumps(bank_examples)}")
